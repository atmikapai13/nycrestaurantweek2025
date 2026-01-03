// api/chat.js
import { app as agentApp, initializeState } from './_langgraph/agent.js';
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

/**
 * Validate that filter queries resulted in actual tool execution
 * Prevents hallucinated responses where agent answers from context
 *
 * @param {string} message - User's original message
 * @param {Object} finalState - Agent's final state after execution
 * @param {Array} toolCallsMade - Array of tool names that were called
 * @returns {Object} { valid: boolean, reason?: string, toolsCalled?: Array }
 */
function validateToolExecution(message, finalState, toolCallsMade) {
  // Detect filter queries - comprehensive keyword list
  const filterKeywords = [
    // Action keywords
    'show me', 'filter', 'only', 'just', 'about', 'what about', 'how about',

    // Broad cuisine categories
    'asian', 'european', 'latin', 'latino', 'middle eastern',

    // Specific cuisines (all 45 from dataset)
    'italian', 'japanese', 'chinese', 'american', 'french', 'mexican', 'thai', 'korean',
    'indian', 'mediterranean', 'steakhouse', 'seafood', 'pizza', 'eclectic', 'gastropub',
    'spanish', 'greek', 'cuban', 'peruvian', 'taiwanese', 'ukrainian', 'british', 'irish',
    'african', 'argentinian', 'austrian', 'barbecue', 'belgian', 'brazilian', 'cajun',
    'creole', 'caribbean', 'colombian', 'continental', 'eastern european', 'hawaiian',
    'pan-asian', 'puerto rican', 'soul food', 'southern', 'turkish', 'vietnamese', 'sushi',

    // Price keywords
    'cheap', 'expensive', 'affordable', 'budget', '$', '$$', '$$$', '$$$$',

    // Rating keywords
    'rating', 'rated', 'star', 'stars', '4+', '4.5', 'highly rated', 'top rated', 'best rated',

    // Award keywords
    'michelin', 'bib gourmand', 'bib', 'nyt', 'nyt top 100', 'top 100'
  ];

  const messageLower = message.toLowerCase();
  const isFilterQuery = filterKeywords.some(keyword => messageLower.includes(keyword));

  if (!isFilterQuery) {
    return { valid: true }; // Not a filter query, no validation needed
  }

  // Check 1: Were relevant tools called?
  const relevantTools = ['filter_restaurants', 'semantic_search_restaurants', 'create_isochrone', 'find_meeting_point'];
  const toolWasCalled = toolCallsMade.some(tool => relevantTools.includes(tool));

  // Check 2: Do we have tool results?
  const hasToolResults = finalState.lastToolResults &&
                        (finalState.lastToolResults.count !== undefined ||
                         finalState.lastToolResults.tool !== undefined);

  // Check 3: Do we have visible restaurants OR explicit zero-result state?
  const hasResults = (finalState.visibleRestaurants && finalState.visibleRestaurants.length > 0) ||
                    (finalState.lastToolResults?.count === 0);

  // VALIDATION FAILURE: Filter query but no tool execution or results
  if (!toolWasCalled || !hasToolResults) {
    return {
      valid: false,
      reason: `Filter query detected but ${!toolWasCalled ? 'no tool was called' : 'no tool results exist'}`,
      toolsCalled: toolCallsMade
    };
  }

  return { valid: true };
}

/**
 * Validate that isochrone modification queries resulted in actual tool execution
 * Prevents agent from responding without creating/updating isochrones
 *
 * @param {string} message - User's original message
 * @param {Object} finalState - Agent's final state after execution
 * @param {Array} toolCallsMade - Array of tool names that were called
 * @param {Object} context - Context from frontend (existing isochrone state)
 * @returns {Object} { valid: boolean, reason?: string, toolsCalled?: Array }
 */
function validateIsochroneExecution(message, finalState, toolCallsMade, context) {
  const messageLower = message.toLowerCase();

  // Detect isochrone modification requests
  const isochroneChangeKeywords = [
    'change it to', 'change to', 'make it', 'update to', 'switch to', 'actually',
    'instead', 'rather', 'let\'s do', 'how about', 'what about', 'nevermind', "i'll be at", "i'm in", "i'm at", "i'll be in"
  ];

  // Detect time/mode specifications
  const timePatterns = [
    /\d+\s*min/i,  // "20 min", "15min"
    /\d+\s*minute/i  // "20 minutes"
  ];
  const modeKeywords = ['walking', 'walk', 'subway', 'transit', 'cycling', 'bike', 'driving', 'car'];

  // Check if message is an isochrone modification request
  const hasChangeKeyword = isochroneChangeKeywords.some(keyword => messageLower.includes(keyword));
  const hasTimeSpec = timePatterns.some(pattern => pattern.test(message));
  const hasModeSpec = modeKeywords.some(keyword => messageLower.includes(keyword));

  // If user is modifying an existing isochrone (context has isochrone params)
  const hasExistingIsochrone = context?.isochrone_params?.allRestaurantSlugs?.length > 0;

  // SCENARIO: User is modifying existing isochrone parameters
  if (hasExistingIsochrone && (hasChangeKeyword || hasTimeSpec || hasModeSpec)) {
    console.log('🔍 Isochrone modification detected:', {
      hasChangeKeyword,
      hasTimeSpec,
      hasModeSpec,
      existingIsochrone: hasExistingIsochrone
    });

    // Check if create_isochrone was called
    const isochroneToolCalled = toolCallsMade.includes('create_isochrone');

    if (!isochroneToolCalled) {
      return {
        valid: false,
        reason: 'Isochrone modification detected but create_isochrone was not called',
        toolsCalled: toolCallsMade
      };
    }
  }

  return { valid: true };
}

/**
 * Validate that map actions correspond to agent's text output
 * Ensures visual representation matches what agent claims
 *
 * @param {Object} response - Response object with text and mapActions
 * @param {Array} toolCallsMade - Array of tool names that were called
 * @returns {Object} { valid: boolean, warnings?: Array }
 */
function validateMapTextCorrespondence(response, toolCallsMade) {
  const warnings = [];
  const agentText = response.response.toLowerCase();

  // Extract time mentions from agent's text
  const timeMatches = agentText.match(/(\d+)\s*min(ute)?s?/g);

  // Check if agent mentions a specific travel time
  if (timeMatches && timeMatches.length > 0) {
    const mentionedTime = parseInt(timeMatches[timeMatches.length - 1]); // Use last mention

    // Check if create_isochrone was called with matching time
    if (toolCallsMade.includes('create_isochrone')) {
      const isochroneParams = response.isochrone_params;
      if (isochroneParams?.travelTimeMinutes && isochroneParams.travelTimeMinutes !== mentionedTime) {
        warnings.push(`Agent mentions ${mentionedTime} min but isochrone created with ${isochroneParams.travelTimeMinutes} min`);
      }
    }
  }

  // Check if agent mentions restaurant count
  const countMatches = agentText.match(/(\d+)\s*restaurant/g);
  if (countMatches && countMatches.length > 0) {
    const mentionedCount = parseInt(countMatches[countMatches.length - 1]);
    const actualCount = response.visible_restaurants?.length || 0;

    // Allow small discrepancies (e.g., "I found 38 restaurants" vs 37 actual)
    if (Math.abs(mentionedCount - actualCount) > 2) {
      warnings.push(`Agent mentions ${mentionedCount} restaurants but actual count is ${actualCount}`);
    }
  }

  // Check if agent mentions mode (walking/subway/etc) matches isochrone
  const modes = ['walking', 'subway', 'transit', 'cycling', 'biking', 'driving'];
  const mentionedMode = modes.find(mode => agentText.includes(mode));
  if (mentionedMode && response.isochrone_params?.mode) {
    let normalizedMentioned = mentionedMode === 'subway' ? 'transit' : mentionedMode;
    normalizedMentioned = normalizedMentioned === 'biking' ? 'cycling' : normalizedMentioned;

    if (normalizedMentioned !== response.isochrone_params.mode) {
      warnings.push(`Agent mentions ${mentionedMode} but isochrone created with ${response.isochrone_params.mode} mode`);
    }
  }

  if (warnings.length > 0) {
    console.warn('⚠️ Map/Text correspondence warnings:', warnings);
    return { valid: true, warnings }; // Return warnings but don't block (soft validation)
  }

  return { valid: true };
}

/**
 * Serverless function for LangGraph chat
 *
 * In Vercel serverless, we can't maintain in-memory sessions across requests.
 * We rely on the frontend to pass the full conversation history.
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, conversationHistory = [], context = {} } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    console.log(`🤖 Processing: "${message.substring(0, 50)}..."`);

    // Detect filter queries and enforce tool use - comprehensive keyword list
    const filterKeywords = [
      // Action keywords
      'show me', 'filter', 'only', 'just', 'about', 'what about', 'how about',

      // Broad cuisine categories
      'asian', 'european', 'latin', 'latino', 'middle eastern',

      // Specific cuisines (all 45 from dataset)
      'italian', 'japanese', 'chinese', 'american', 'french', 'mexican', 'thai', 'korean',
      'indian', 'mediterranean', 'steakhouse', 'seafood', 'pizza', 'eclectic', 'gastropub',
      'spanish', 'greek', 'cuban', 'peruvian', 'taiwanese', 'ukrainian', 'british', 'irish',
      'african', 'argentinian', 'austrian', 'barbecue', 'belgian', 'brazilian', 'cajun',
      'creole', 'caribbean', 'colombian', 'continental', 'eastern european', 'hawaiian',
      'pan-asian', 'puerto rican', 'soul food', 'southern', 'turkish', 'vietnamese', 'sushi',

      // Price keywords
      'cheap', 'expensive', 'affordable', 'budget', '$', '$$', '$$$', '$$$$',

      // Rating keywords
      'rating', 'rated', 'star', 'stars', '4+', '4.5', 'highly rated', 'top rated', 'best rated',

      // Award keywords
      'michelin', 'bib gourmand', 'bib', 'nyt', 'nyt top 100', 'top 100'
    ];

    const messageLower = message.toLowerCase();
    const isFilterQuery = filterKeywords.some(keyword => messageLower.includes(keyword));

    // If user is filtering within an active isochrone, force tool use
    if (isFilterQuery && context.isochrone_params?.allRestaurantSlugs?.length > 0) {
      console.log('⚠️ Filter query detected within isochrone - enforcing tool use');
    }

    // Convert frontend's GeminiMessage format to LangChain Message objects
    // Frontend sends: [{ role: 'user'|'model', parts: [{ text: '...' }] }]
    // We need: [HumanMessage(...), AIMessage(...)]
    const messages = conversationHistory
      .map(msg => {
        // Handle GeminiMessage format from frontend
        if (msg.parts && Array.isArray(msg.parts)) {
          const textPart = msg.parts.find(p => p.text);
          if (textPart) {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            if (role === 'user') {
              return new HumanMessage(textPart.text);
            } else if (role === 'assistant') {
              return new AIMessage(textPart.text);
            }
          }
        }
        // Already in correct format (plain object)
        // Check for ToolMessage specifically
        if (msg._getType && msg._getType() === 'tool' && msg.name === 'create_isochrone') {
          return new ToolMessage({
            tool_call_id: msg.tool_call_id,
            content: msg.content,
            name: msg.name,
          });
        }
        if (msg.content) {
          if (msg.role === 'user') {
            return new HumanMessage(msg.content);
          } else if (msg.role === 'assistant' || msg.role === 'model') {
            return new AIMessage(msg.content);
          }
        }
        return null;
      })
      .filter(msg => msg !== null); // Remove any invalid messages

    // Add current user message (with tool enforcement if needed)
    if (isFilterQuery && context.isochrone_params?.allRestaurantSlugs?.length > 0) {
      // Prepend strong instruction to force tool use
      const enforcedMessage = `[CRITICAL INSTRUCTION: This is a filter/search query. You MUST call filter_restaurants or semantic_search_restaurants. DO NOT answer from conversation history or memory. CALL THE TOOL FIRST.]\n\n${message}`;
      messages.push(new HumanMessage(enforcedMessage));
    } else {
      messages.push(new HumanMessage(message));
    }

    // Initialize agent state with context from frontend (if any)
    // Note: Verify script passes empty state. Here we might want to respect existing filters?
    // But usually with LangGraph, the state is re-derived from the history or passed explicitly.
    // Ideally, frontend should pass the *last known state* if possible, 
    // but typically we just re-run with history.
    // For this MVP, we initialize fresh state + history.

    const initialState = initializeState(messages);

    // Restore isochrone params (contains allRestaurantSlugs for tool scoping)
    // DON'T restore visibleRestaurants - agent must call tools to get data
    if (context.isochrone_params) {
      initialState.isochroneParams = context.isochrone_params;
      const baseCount = context.isochrone_params.allRestaurantSlugs?.length || 0;
      if (baseCount > 0) {
        console.log(`♻️ Restored isochrone params: ${baseCount} base restaurants for scoping`);
      }
    }

    // CRITICAL: Also restore isochrone layers for multi-party isochrone visualization
    if (context.isochrone_layers && Array.isArray(context.isochrone_layers)) {
      initialState.isochroneLayers = context.isochrone_layers;
      console.log(`♻️ Restored ${context.isochrone_layers.length} isochrone layers for visualization`);
    }

    // Run agent with validation retry mechanism
    let finalState;
    let retryCount = 0;
    const MAX_RETRIES = 1; // Only retry once to avoid loops

    while (retryCount <= MAX_RETRIES) {
      // invoke returns the FINAL state
      finalState = await agentApp.invoke(initialState);

      // Extract tool calls made during this execution
      const toolCallsMade = [];
      finalState.messages.forEach(msg => {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          msg.tool_calls.forEach(tc => toolCallsMade.push(tc.name));
        }
      });

      // VALIDATION 1: Filter query validation
      const filterValidation = validateToolExecution(message, finalState, toolCallsMade);

      // VALIDATION 2: Isochrone modification validation
      const isochroneValidation = validateIsochroneExecution(message, finalState, toolCallsMade, context);

      // COMBINED: Fail if either validation fails
      const validation = {
        valid: filterValidation.valid && isochroneValidation.valid,
        reason: !filterValidation.valid ? filterValidation.reason : isochroneValidation.reason,
        toolsCalled: toolCallsMade,
        failedType: !filterValidation.valid ? 'filter' : 'isochrone'
      };

      if (validation.valid) {
        console.log(`✅ Validation passed: Tool execution confirmed`);
        break; // Success - exit retry loop
      }

      // Validation failed
      if (retryCount === MAX_RETRIES) {
        console.error(`❌ Validation failed after ${MAX_RETRIES} retries:`, validation.reason);
        console.error(`   Tools called: ${validation.toolsCalled.join(', ') || 'NONE'}`);
        // Allow response to proceed (logged for debugging)
        break;
      }

      // Retry with MAXIMUM enforcement
      console.warn(`⚠️ Validation failed (attempt ${retryCount + 1}): ${validation.reason}`);
      console.warn(`   Re-invoking agent with mandatory tool call instruction...`);

      // Determine which validation failed and craft appropriate enforcement message
      const failedType = validation.failedType === 'filter' ? 'filter/search' : 'isochrone modification';
      const requiredTools = validation.failedType === 'filter'
        ? 'filter_restaurants or semantic_search_restaurants'
        : 'create_isochrone';

      // Add CRITICAL system-level enforcement message
      const enforcementMessage = new HumanMessage(`[SYSTEM OVERRIDE - CRITICAL]: The previous response violated architectural rules. You answered a ${failedType} query WITHOUT calling the required tool. This is a HARD FAILURE.

You MUST call ${requiredTools} for the query "${message}".

DO NOT respond from memory or conversation history. CALL THE TOOL FIRST, then summarize the results.`);

      // Add enforcement message to state for retry
      initialState.messages.push(enforcementMessage);
      retryCount++;
    }

    // Extract assistant response
    const finalMessages = finalState.messages;
    const lastMessage = finalMessages[finalMessages.length - 1];

    // Extract tool calls that were made (for frontend to know what happened)
    const toolCalls = [];
    finalMessages.forEach(msg => {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        msg.tool_calls.forEach(tc => {
          toolCalls.push(tc.name);
          console.log(`🔧 Tool called: ${tc.name} with args:`, JSON.stringify(tc.args, null, 2));
        });
      }
    });

    // Log validation warning if filter query resulted in zero tool calls
    if (toolCalls.length === 0 && isFilterQuery) {
      console.warn(`⚠️ WARNING: Filter query "${message.substring(0, 50)}..." resulted in ZERO tool calls`);
    }

    // Process output for frontend
    const response = {
      response: typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content),
      visible_restaurants: finalState.visibleRestaurants || [],
      isochrone_data: finalState.isochroneLayers?.[0] || null, // Single polygon for compatibility
      isochrone_layers: finalState.isochroneLayers || [], // Array of all layers
      isochrone_params: finalState.isochroneParams || {},
      current_filters: finalState.currentFilters || {},
      tool_calls: toolCalls, // List of tools that were called
      map_actions: finalState.mapActions || [], // Visual map actions to execute
      // Validation metadata for debugging/monitoring
      _validation: {
        retryCount: retryCount,
        toolsExecuted: toolCalls.length > 0
      }
    };

    // VALIDATION 3: Map/Text correspondence (soft validation)
    const correspondenceValidation = validateMapTextCorrespondence(response, toolCalls);

    if (correspondenceValidation.warnings?.length > 0) {
      // Add warnings to response for debugging
      response._validation.correspondenceWarnings = correspondenceValidation.warnings;
    }

    // Return response
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Chat error:', error);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}