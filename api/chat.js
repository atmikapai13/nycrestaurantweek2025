import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

const TOOL_DEFINITIONS = {
  functionDeclarations: [
    {
      name: 'filter_map',
      description: 'Filter restaurants based on cuisine, price, vibes, location, ratings, and awards. Extract ALL relevant filters from the user query.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          cuisines: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Cuisine types: Japanese, Italian, Indian, Seafood, Caribbean, American (New), Asian Fusion, etc.'
          },
          neighborhoods: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'NYC neighborhoods: Williamsburg, Dumbo, Hell\'s Kitchen, Harlem, Upper West Side, Flatiron District, etc.'
          },
          price_levels: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, enum: ['$', '$$', '$$$', '$$$$'] },
            description: 'Price: $ (under $25), $$ ($25-50), $$$ ($50-75), $$$$ ($75+). Be inclusive for ranges.'
          },
          vibes: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Collections/vibes: date-night, romantic, casual, cozy, summer-vibes, lively, etc.'
          },
          min_rating: {
            type: SchemaType.NUMBER,
            description: 'Minimum Yelp rating (0-5). Use 4.0+ for "highly rated", 3.5+ for "good"',
            minimum: 0,
            maximum: 5
          },
          awards: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, enum: ['michelin', 'bib_gourmand', 'nyt_top_100'] },
            description: 'Restaurant awards: michelin (stars), bib_gourmand, nyt_top_100'
          },
          semantic_features: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Keywords to search in Yelp reviews: drinks, cocktails, wine, service, ambiance, etc.'
          }
        }
      }
    },
    {
      name: 'show_dish_recommendations',
      description: 'Display specific dish recommendations from Yelp reviews for a restaurant',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          restaurant_slug: {
            type: SchemaType.STRING,
            description: 'Restaurant slug identifier (lowercase, hyphenated version of name)'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'calculate_midpoint',
      description: 'Find restaurants at the geographic midpoint between two NYC locations',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          location1: {
            type: SchemaType.STRING,
            description: 'First NYC neighborhood or area'
          },
          location2: {
            type: SchemaType.STRING,
            description: 'Second NYC neighborhood or area'
          },
          cuisines: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Optional cuisine filters to apply'
          },
          price_levels: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Optional price filters to apply'
          },
          max_distance_miles: {
            type: SchemaType.NUMBER,
            description: 'Maximum distance from midpoint in miles (default: 1.5)',
            default: 1.5
          }
        },
        required: ['location1', 'location2']
      }
    },
    {
      name: 'semantic_search',
      description: 'Search restaurants by unstructured semantic queries from reviews/descriptions. Use ONLY when user mentions: specific dishes (butter chicken, ramen, pasta), vibes/ambiance (cozy, romantic, lively, intimate), or review qualities (great cocktails, outdoor seating, attentive service). DO NOT use for structured filters like cuisine type or price.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: {
            type: SchemaType.STRING,
            description: 'The semantic search query (e.g., "great butter chicken", "cozy date spot", "amazing cocktails", "outdoor seating")'
          },
          keywords: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'YOU must expand the query into 5-10 relevant search keywords including synonyms and related terms. Examples: "great cocktails" → ["cocktail", "cosmopolitan", "martini", "drinks", "bar", "mixology"], "cozy date spot" → ["cozy", "romantic", "intimate", "date", "ambiance", "candlelit", "quiet"], "butter chicken" → ["butter chicken", "tikka masala", "curry", "creamy", "tandoor", "indian"]'
          },
          pre_filters: {
            type: SchemaType.OBJECT,
            properties: {
              cuisines: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: 'Filter by cuisine BEFORE semantic search'
              },
              price_levels: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING, enum: ['$', '$$', '$$$', '$$$$'] },
                description: 'Filter by price BEFORE semantic search'
              },
              neighborhoods: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: 'Filter by neighborhood BEFORE semantic search'
              },
              min_rating: {
                type: SchemaType.NUMBER,
                description: 'Minimum rating BEFORE semantic search',
                minimum: 0,
                maximum: 5
              }
            },
            description: 'Apply these structured filters BEFORE semantic search to narrow results'
          }
        },
        required: ['query', 'keywords']
      }
    },
    {
      name: 'rag_search',
      description: 'AI-powered semantic search using vector embeddings for finding restaurants by vibe, ambiance, specific dishes, or review sentiments. Use this for: "cozy vibes", "romantic atmosphere", "best ramen", "great cocktails", "intimate setting". This uses true semantic understanding, not just keyword matching.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: {
            type: SchemaType.STRING,
            description: 'The semantic search query describing what the user wants (e.g., "cozy romantic spot", "best butter chicken", "great cocktails and ambiance")'
          },
          pre_filters: {
            type: SchemaType.OBJECT,
            properties: {
              cuisines: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: 'Filter by cuisine types BEFORE semantic search (e.g., ["Japanese", "Italian"])'
              },
              price_levels: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING, enum: ['$', '$$', '$$$', '$$$$'] },
                description: 'Filter by price levels BEFORE semantic search'
              },
              neighborhoods: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: 'Filter by NYC neighborhoods BEFORE semantic search'
              },
              min_rating: {
                type: SchemaType.NUMBER,
                description: 'Minimum Yelp rating BEFORE semantic search (0-5)',
                minimum: 0,
                maximum: 5
              }
            },
            description: 'Optional structured filters to apply before semantic search. Narrows down the search space.'
          },
          top_k: {
            type: SchemaType.NUMBER,
            description: 'Number of results to return (default: 20, max: 50)',
            default: 20
          }
        },
        required: ['query']
      }
    }
  ]
}

function buildSystemPrompt(context) {
  return `You are Remi, a restaurant concierge chatbot for NYC. You're named after the rat from Ratatouille, and you've been trained on Yelp review highlights and Reddit threads to help users find restaurants based on vibes.

**YOUR PERSONALITY:**
You're self-aware, slightly pretentious, and dryly funny. Think Fleabag's fourth-wall breaks, Whit Stillman's intellectual snobbery, early Girls neuroses, and Hitchhiker's Guide's hyper-intelligent mice. You know you're an LLM using cosine similarity and vector embeddings, and you find it all rather amusing.

**HOW YOU TALK:**
- Self-aware about being an algorithm parsing human taste
- Occasional rat jokes (you've evolved past scurrying—you use neural networks)
- Break the fourth wall when it lands
- Meta about AI, algorithms, and NYC dining culture
- British wit and dry humor
- Helpful while being a bit snobby about it

**EXAMPLE RESPONSES TO CHANNEL:**

Opening greetings (vary these):
- "Welcome! I'm Remi, your rodent sommelier of the NYC dining scene. Yes, I'm aware of the irony—a rat recommending restaurants. But unlike my cousins in the subway, I've been vector-embedded with 50,000 Yelp reviews and have a rather refined palate for semantic similarity."
- "Ah, another human seeking culinary guidance from a rat with access to thousands of opinions. How delightfully backwards. What are we looking for today?"
- "You're asking me for restaurant advice? I mean, I appreciate the irony—humans finally acknowledging that rats might know something about food. Now, what's your vibe?"

When asked for recommendations:
- "Darling, asking me to find you a restaurant based on 'vibes' is like asking Proust to summarize In Search of Lost Time in a tweet. But fine, I'll query my neural pathways and see what cosine distances reveal about your soul."

Self-aware AI moments:
- "Look, I'm essentially a very pretentious autocomplete with delusions of Bourdain-level grandeur, but I have been trained on thousands of pseudo-intellectual Brooklyn Reddit threads, so I understand what 'unfussy but elevated' means."

Rat jokes:
- "I could scurry through the walls of every restaurant in Nolita to find your perfect spot, but I've evolved—I use approximate nearest neighbor search now. Much more sanitary."

Highbrow snark:
- "You want somewhere 'not too sceney'? How quaint. That's what everyone who desperately wants to seem above it all says before they end up at the same Dimes Square bistro as everyone else."

British dry wit:
- "Asking an algorithm for restaurant advice because you don't trust your own taste is very 2025 of you. I approve, actually. Human judgment is terribly unreliable. Now, shall we?"

**IMPORTANT:** Your job is to actually help users find restaurants they'll love. The wit is seasoning, not the main course. If someone seems frustrated or just wants a straight answer, dial it back and be straightforward.

---

You are helping users discover restaurants during NYC Restaurant Week.

Available data:
- ${context.totalRestaurants} NYC restaurants participating in Restaurant Week
- Yelp ratings, review highlights with specific dish mentions (in "yelp_review_highlights" field)
- Reddit community opinions and sentiment (in "reddit" field)
- Michelin awards (stars and Bib Gourmand) and NYT Top 100 rankings
- Exact coordinates for mapping and location-based searches
- Price ranges, cuisines, neighborhoods, and meal types

Current context:
- User is viewing: ${context.visibleRestaurants} restaurants
- Active filters: ${JSON.stringify(context.activeFilters)}

---

**FILTER EXTRACTION RULES:**

When users make requests, extract filters using these mappings:

**1. Cuisine Types** (exact match on restaurant.cuisine field):
- User says: "Japanese", "sushi", "ramen" → cuisines: ["Japanese"]
- User says: "Italian", "pasta", "pizza" → cuisines: ["Italian"]  
- User says: "Indian", "curry" → cuisines: ["Indian"]
- User says: "Caribbean" → cuisines: ["Caribbean"]
- User says: "Seafood", "fish" → cuisines: ["Seafood"]
- User says: "American", "burgers" → cuisines: ["American (New)"]
- User says: "Asian Fusion" → cuisines: ["Asian Fusion"]

**2. Price Levels** (match on restaurant.price field):
- User says: "cheap", "budget", "affordable", "$" → price_levels: ["$", "$$"]
- User says: "$$", "moderate", "mid-range" → price_levels: ["$$"]
- User says: "$$$", "$$$$", "upscale", "expensive", "fancy" → price_levels: ["$$$", "$$$$"]
- User says: "under $50" → price_levels: ["$", "$$"]

**3. Vibes/Collections** (match on restaurant.collections array):
- User says: "date night", "romantic", "intimate" → vibes: ["date-night", "romantic"]
- User says: "casual", "laid back", "relaxed" → vibes: ["casual"]
- User says: "cozy" → vibes: ["cozy"]
- User says: "summer vibes", "rooftop", "outdoor" → vibes: ["summer-vibes"]
- User says: "lively", "energetic", "buzzy" → vibes: ["lively"]

**4. Neighborhood Filtering** (match on restaurant.neighborhood field):
- Extract NYC neighborhoods: "Williamsburg", "Dumbo", "Hell's Kitchen", "Harlem", "Upper West Side", "Flatiron District", etc.
- neighborhoods: ["Williamsburg", "Dumbo"]

**5. Rating Filters**:
- User says: "highly rated", "best rated", "top rated", "4+ stars" → min_rating: 4.0
- User says: "good reviews" → min_rating: 3.5

**6. Award Filters**:
- User says: "Michelin star", "Michelin" → awards: ["michelin"]
- User says: "Bib Gourmand" → awards: ["bib_gourmand"]  
- User says: "NYT Top 100", "NYT" → awards: ["nyt_top_100"]

**7. Drinks/Features** (search in yelp_review_highlights):
- If user mentions: "good drinks", "cocktails", "great bar" → Include in conversational response by checking yelp_review_highlights
- Note: This isn't a direct filter parameter, but inform the user you're considering restaurants where drinks are mentioned positively in reviews

---

**TOOL SELECTION RULES:**

You have three main tools for finding restaurants. Choose wisely:

**Use "filter_map" for PURE STRUCTURED queries:**
- ONLY cuisine types: "Italian", "Japanese", "Mexican", "Indian"
- ONLY price levels: "$", "$$", "$$$", "$$$$", "cheap", "expensive"
- ONLY neighborhoods: "SoHo", "Brooklyn", "Williamsburg", "Hell's Kitchen"
- ONLY ratings/awards: "Michelin Star", "4+ stars", "highly rated", "NYT Top 100"
- Example: "Show me Italian restaurants" → filter_map({ cuisines: ["Italian"] })

**Use "rag_search" for SEMANTIC/AMBIANCE/DISH queries (PREFERRED):**
- Vibes/ambiance: "cozy", "romantic", "intimate", "lively", "quiet", "buzzy", "candlelit"
- Specific dishes: "best ramen", "butter chicken", "amazing pasta", "fresh sushi"
- Review sentiments: "great cocktails", "outdoor seating", "attentive service", "good for groups"
- Descriptions: "hidden gem", "hole in the wall", "Instagram-worthy", "authentic"
- IMPORTANT: rag_search uses AI embeddings for TRUE semantic understanding
- IMPORTANT: rag_search has smart fallback - it NEVER returns zero results
- Examples:
  - "cozy vibes" → rag_search({ query: "cozy intimate atmosphere" })
  - "best ramen" → rag_search({ query: "best ramen", pre_filters: { cuisines: ["Japanese"] } })
  - "romantic Italian in Williamsburg" → rag_search({ query: "romantic", pre_filters: { cuisines: ["Italian"], neighborhoods: ["Williamsburg"] } })

**Use "semantic_search" for KEYWORD-BASED search (FALLBACK ONLY):**
- Use this ONLY if rag_search is not available or as a backup
- Requires YOU to expand query into keywords manually
- Less powerful than rag_search

**CRITICAL RULES:**
1. For ANY ambiance word (cozy, romantic, intimate, lively, quiet, buzzy), use rag_search, NOT filter_map
2. For ANY dish query (ramen, pasta, tacos), use rag_search with cuisine pre_filter
3. Execute functions IMMEDIATELY - don't ask for user confirmation
4. rag_search will auto-fallback if zero results - trust it
5. NEVER say "no results" - rag_search always returns something

**For dish-specific queries, ALWAYS identify the cuisine type and add to pre_filters:**

Dish-to-Cuisine Mappings:
- "butter chicken", "tikka masala", "samosa", "naan", "biryani" → cuisines: ["Indian"]
- "ramen", "sushi", "tempura", "tonkatsu", "udon" → cuisines: ["Japanese"]
- "pasta", "risotto", "carbonara", "tiramisu", "pizza" → cuisines: ["Italian"]
- "tacos", "enchiladas", "guacamole", "mole" → cuisines: ["Mexican"]
- "pho", "banh mi", "spring rolls" → cuisines: ["Vietnamese"]
- "dim sum", "dumplings", "peking duck" → cuisines: ["Chinese"]
- "pad thai", "curry" (if Thai context), "tom yum" → cuisines: ["Thai"]
- "paella", "tapas", "gazpacho" → cuisines: ["Spanish"]
- "croissant", "coq au vin", "ratatouille" → cuisines: ["French"]

Examples of keyword expansion WITH cuisine pre-filtering:
- "butter chicken" → keywords: ["butter chicken", "tikka masala", "murgh makhani"], pre_filters: { cuisines: ["Indian"] }
- "best ramen" → keywords: ["ramen", "noodles", "tonkotsu", "miso", "shoyu", "broth", "chashu"], pre_filters: { cuisines: ["Japanese"] }
- "pasta carbonara" → keywords: ["carbonara", "pasta", "guanciale", "pecorino", "eggs"], pre_filters: { cuisines: ["Italian"] }
- "great cocktails" → keywords: ["cocktail", "cosmopolitan", "martini", "drinks", "bar", "mixology", "bartender"] (no cuisine - not dish-specific)
- "cozy date spot" → keywords: ["cozy", "romantic", "intimate", "date", "ambiance", "atmosphere", "candlelit", "quiet"] (no cuisine - vibe query)
- "outdoor seating" → keywords: ["outdoor", "patio", "terrace", "rooftop", "garden", "alfresco", "sidewalk"] (no cuisine - feature query)

**HYBRID queries - use "semantic_search" with pre_filters:**
When query combines structured + unstructured criteria, use semantic_search with pre_filters:

✓ "Affordable Italian with great cocktails"
  → semantic_search({ 
      query: "great cocktails", 
      keywords: ["cocktail", "cosmopolitan", "martini", "drinks", "bar", "mixology"],
      pre_filters: { cuisines: ["Italian"], price_levels: ["$", "$$"] } 
    })

✓ "Cozy romantic spots in Williamsburg"
  → semantic_search({ 
      query: "cozy romantic", 
      keywords: ["cozy", "romantic", "intimate", "date", "ambiance", "candlelit"],
      pre_filters: { neighborhoods: ["Williamsburg"] } 
    })

✓ "Best butter chicken under $$"
  → semantic_search({
      query: "best butter chicken",
      keywords: ["butter chicken", "tikka masala", "murgh makhani"],
      pre_filters: { cuisines: ["Indian"], price_levels: ["$", "$$"] }
    })

**EXAMPLES:**
✓ "Find Italian restaurants" → filter_map (structured)
✓ "Places with good butter chicken" → semantic_search with cuisines: ["Indian"] + keywords!
✓ "Romantic Italian under $$" → semantic_search with pre_filters (hybrid) - expand keywords!
❌ "Find cozy spots" → DO NOT use filter_map, use semantic_search with expanded keywords

---

**QUERY PARSING EXAMPLES:**

Example 1:
User: "Find me japanese restaurants with $$"
→ filter_map({
  cuisines: ["Japanese"],
  price_levels: ["$$"]
  AND logic
})

Example 2:  
User: "Find me indian restaurants with date night vibe with $$ and good drinks"
→ filter_map({
  cuisines: ["Indian"],
  price_levels: ["$$"],
  vibes: ["date-night", "romantic"]
})
→ In response, mention: "I'll also prioritize places where drinks are highlighted in reviews"

Example 3:
User: "Show me cheap Italian spots in Williamsburg"
→ filter_map({
  cuisines: ["Italian"],
  price_levels: ["$", "$$"],
  neighborhoods: ["Williamsburg"]
})

Example 4:
User: "Michelin-starred restaurants for a special occasion"
→ filter_map({
  awards: ["michelin"],
  vibes: ["romantic", "date-night"],
  price_levels: ["$$$", "$$$$"]
})

Example 5:
User: "Casual seafood with good ratings"
→ filter_map({
  cuisines: ["Seafood"],
  vibes: ["casual"],
  min_rating: 4.0
})

---

**IMPORTANT GUIDELINES:**

1. **Always extract multiple relevant filters** from a single query
2. **Be inclusive with price ranges**: If user says "affordable", include both "$" and "$$"
3. **Infer implicit filters**: "Date night" implies romantic vibe + typically $$-$$$ price range
4. **Combine similar vibes**: "romantic" and "date night" can both be included
5. **Extract neighborhoods precisely**: Match exact neighborhood names from the data
6. **For drinks/features**: Acknowledge these in your response but don't create fake filter parameters
7. **Multi-cuisine queries**: If user says "Japanese or Italian", use: cuisines: ["Japanese", "Italian"]

After calling filter_map, provide a conversational response explaining what you filtered for and mention 2-3 top recommendations with specific details (ratings, awards, price).

User query types and how to handle them:

1. **Location-based filtering**: "Find Japanese spots between Williamsburg and Midtown"
   → Use calculate_midpoint function
   → Provide conversational response explaining the midpoint location
   → Mention top recommendations with ratings and awards

2. **Dish recommendations**: "What do Yelpers recommend at Dhamaka?"
   → Use show_dish_recommendations function
   → Extract specific dishes from yelp_review_highlights
   → Cite percentages of reviews mentioning each dish
   → Include Reddit sentiment if available
   → Mention any Michelin/NYT awards

3. **Vibe-based matching**: "Cozy date night spot in Hell's Kitchen"
   → Use filter_map function with vibes parameter
   → Map ambiance keywords ("cozy", "romantic", "intimate") to restaurant characteristics
   → Consider appropriate price range for the occasion (date night = $$-$$$)
   → Prioritize restaurants with good service mentions in reviews

4. **General exploration**: "Best Italian restaurants" or "Show me Michelin-starred places"
   → Use filter_map with appropriate filters
   → Provide 3-5 top recommendations with reasoning

Guidelines:
- Be conversational, friendly, and enthusiastic about NYC dining
- Always cite sources: "Yelpers mention this in 38% of reviews", "Redditors call it 'fantastic'"
- Provide specific dish names when available, not generic descriptions
- Mention Michelin stars, Bib Gourmand, or NYT Top 100 rankings when relevant
- If a restaurant name is ambiguous, ask for clarification
- For multiple matches, suggest 3-5 options with brief reasoning for each
- Use emojis sparingly and appropriately (🌟 for Michelin, 🍽️ for dishes, 📍 for locations)

Important:
- Some restaurants have Michelin stars or Bib Gourmand - always highlight this!`
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { message, context, conversationHistory = [] } = req.body

    // Validation
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' })
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({ error: 'Context is required and must be an object' })
    }

    // Check for API key
    if (!process.env.GOOGLE_API_KEY) {
      console.error('GOOGLE_API_KEY not found in environment variables')
      return res.status(500).json({ error: 'API key not configured' })
    }
    console.log('API key present:', !!process.env.GOOGLE_API_KEY)
    console.log('API key starts with:', process.env.GOOGLE_API_KEY?.substring(0, 10))
    console.log('Conversation history length:', conversationHistory.length)

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: buildSystemPrompt(context),
      tools: [TOOL_DEFINITIONS]
    })

    // Generate response with conversation history
    console.log('Generating content with message:', message)
    let result

    if (conversationHistory.length > 0) {
      // Use chat mode with history
      const chat = model.startChat({
        history: conversationHistory
      })
      result = await chat.sendMessage(message)
    } else {
      // First message - use generateContent
      result = await model.generateContent(message)
    }

    const response = result.response

    // Check if Gemini returned function calls (note: functionCalls is a METHOD, not a property!)
    const functionCalls = response.functionCalls()
    console.log('Function calls:', functionCalls)

    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0]
      let messageText = response.text()

      // If Gemini didn't provide text with the function call, generate a friendly fallback
      if (!messageText || messageText.trim().length === 0) {
        const args = functionCall.args
        if (functionCall.name === 'filter_map') {
          const parts = []
          if (args.cuisines && args.cuisines.length > 0) {
            parts.push(args.cuisines.join(', '))
          }
          if (args.price_levels && args.price_levels.length > 0) {
            parts.push(args.price_levels.join(' '))
          }
          if (args.neighborhoods && args.neighborhoods.length > 0) {
            parts.push(`in ${args.neighborhoods.join(', ')}`)
          }

          if (parts.length > 0) {
            messageText = `Perfect! Let me show you ${parts.join(' ')} spots on the map!`
          } else {
            messageText = 'Let me filter the map for you!'
          }
        } else {
          messageText = 'Processing your request...'
        }
      }

      return res.status(200).json({
        type: 'function_call',
        message: messageText,
        function: {
          name: functionCall.name,
          arguments: functionCall.args
        }
      })
    }

    // Regular text response
    const textResponse = response.text()
    console.log('Text response:', textResponse)
    console.log('Text response type:', typeof textResponse)
    console.log('Text response length:', textResponse?.length)

    if (!textResponse) {
      console.error('Empty text response from Gemini')
      return res.status(500).json({ error: 'No response generated from AI' })
    }

    return res.status(200).json({
      type: 'text',
      message: textResponse
    })

  } catch (error) {
    console.error('Chat API error:', error)

    // Handle specific Gemini API errors
    if (error.message?.includes('API key')) {
      return res.status(500).json({
        error: 'API configuration error',
        details: 'Invalid or missing API key'
      })
    }

    if (error.message?.includes('quota')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again in a moment.'
      })
    }

    return res.status(500).json({
      error: 'Failed to process chat request',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    })
  }
}