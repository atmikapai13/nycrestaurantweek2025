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
  // Detect filter queries (same keywords as existing detection)
  const filterKeywords = ['show me', 'filter', 'only', 'just', 'italian', 'japanese',
                         'chinese', 'american', 'french', 'mexican', 'thai', 'korean',
                         'indian', 'mediterranean', 'steakhouse', 'seafood', 'pizza',
                         'cheap', 'expensive', '$$', '$$$', '$$$$', 'about', 'what about',
                         'how about'];

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

    // Detect filter queries and enforce tool use
    const filterKeywords = ['show me', 'filter', 'only', 'just', 'italian', 'japanese',
                           'chinese', 'american', 'french', 'mexican', 'thai', 'korean',
                           'indian', 'mediterranean', 'steakhouse', 'seafood', 'pizza',
                           'cheap', 'expensive', '$$', '$$$', '$$$$'];

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

      // Validate tool execution for filter queries
      const validation = validateToolExecution(message, finalState, toolCallsMade);

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

      // Add CRITICAL system-level enforcement message
      const enforcementMessage = new HumanMessage(`[SYSTEM OVERRIDE - CRITICAL]: The previous response violated architectural rules. You answered a filter/search query WITHOUT calling the required tool. This is a HARD FAILURE.

You MUST call one of these tools for the query "${message}":
- filter_restaurants (for cuisine/price/awards/rating filters)
- semantic_search_restaurants (for vibe/ambiance/quality searches)

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