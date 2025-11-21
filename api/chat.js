import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

// Redis utilities - will be loaded lazily
let redisUtils = null
async function getRedisUtils() {
  if (redisUtils) return redisUtils

  try {
    const [redisModule, rateLimitModule] = await Promise.all([
      import('./lib/redis.js'),
      import('./lib/rateLimit.js')
    ])
    redisUtils = {
      cacheGet: redisModule.cacheGet,
      cacheSet: redisModule.cacheSet,
      createCacheKey: redisModule.createCacheKey,
      checkRateLimit: rateLimitModule.checkRateLimit
    }
  } catch (error) {
    console.log('Redis not available - caching disabled')
    redisUtils = {
      cacheGet: async () => null,
      cacheSet: async () => false,
      createCacheKey: () => '',
      checkRateLimit: async () => true
    }
  }
  return redisUtils
}

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
          expand_neighborhoods: {
            type: SchemaType.BOOLEAN,
            description: 'Set to true if user says "in and around", "near", "nearby", or similar. Expands search to include adjacent neighborhoods. Default: false'
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
      description: 'Find restaurants at the TRUE geographic midpoint between two NYC locations. Calculates the actual midpoint coordinates and returns restaurants within a radius, sorted by balance (equal distance from both locations). Use for queries like "restaurants between X and Y" or "meet in the middle".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          location1: {
            type: SchemaType.STRING,
            description: 'First NYC neighborhood or area (e.g., "Williamsburg", "Kips Bay", "Upper West Side")'
          },
          location2: {
            type: SchemaType.STRING,
            description: 'Second NYC neighborhood or area'
          },
          radiusMiles: {
            type: SchemaType.NUMBER,
            description: 'Search radius around midpoint in miles. Default: 1.0 miles. Use 1.5 for broader searches, 0.5 for "very close"',
            default: 1.0
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
          },
          use_current_results: {
            type: SchemaType.BOOLEAN,
            description: 'If true (DEFAULT), search only within currently visible restaurants on the map (respects isochrones, filters, etc.). Set to false ONLY if user explicitly asks to search "all restaurants" or "across all of NYC". When user says "within these", "from these results", "in this area", this should be true.',
            default: true
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
          },
          use_current_results: {
            type: SchemaType.BOOLEAN,
            description: 'If true (DEFAULT), search only within currently visible restaurants on the map (respects isochrones, filters, etc.). Set to false ONLY if user explicitly asks to search "all restaurants" or "across all of NYC". When user says "within these", "from these results", "in this area", this should be true.',
            default: true
          }
        },
        required: ['query']
      }
    },
    {
      name: 'get_current_results',
      description: 'CRITICAL TOOL: Get intelligent summary of restaurants currently visible on the map. ALWAYS use this when user asks about search results in ANY form: "what did you find?", "show me results", "what restaurants?", "what kind of restaurants?", "tell me about them", "you found X restaurants", etc. Returns aggregate statistics (cuisine breakdown, neighborhoods, price breakdown, ratings, awards) and top 3 examples. DO NOT respond conversationally without calling this function first.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          include_examples: {
            type: SchemaType.BOOLEAN,
            description: 'Include top 3 restaurant names as examples (default: true)',
            default: true
          }
        }
      }
    },
    {
      name: 'get_restaurant_vibe',
      description: 'Get atmosphere and ambiance description for a specific restaurant from Yelp reviews. Use when user asks about vibe, atmosphere, scene, or mood. Returns ONLY vibe description - terse and focused.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          restaurant_slug: {
            type: SchemaType.STRING,
            description: 'Restaurant slug identifier (lowercase, hyphenated, e.g., "lilia", "carbone", "via-carota")'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'get_restaurant_price_info',
      description: 'Get pricing and administrative details for a specific restaurant. Use when user asks about price, cost, expense, delivery, takeout, or contact info. Returns ONLY price/admin details - terse and focused.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          restaurant_slug: {
            type: SchemaType.STRING,
            description: 'Restaurant slug identifier (lowercase, hyphenated, e.g., "lilia", "carbone")'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'get_restaurant_reviews',
      description: 'Get what people (Yelp reviewers and Redditors) think about a specific restaurant. Use when user asks about reviews, opinions, ratings, or "what do people say". Returns both Yelp highlights and Reddit mentions.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          restaurant_slug: {
            type: SchemaType.STRING,
            description: 'Restaurant slug identifier (lowercase, hyphenated, e.g., "lilia")'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'get_restaurant_summary',
      description: 'Get basic description and concept for a specific restaurant. Use when user asks "tell me about this place", "what kind of restaurant is it", or wants general overview. Returns restaurant summary, cuisine type, and neighborhood.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          restaurant_slug: {
            type: SchemaType.STRING,
            description: 'Restaurant slug identifier (lowercase, hyphenated, e.g., "lilia")'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'geocode_address',
      description: 'Convert an NYC address, landmark, or POI to coordinates for spatial queries. Understands NYC slang (LIC, FiDi, UWS, etc.). Use when user mentions a specific location that needs to be converted to coordinates. Examples: "near Times Square", "around the Vessel", "close to Grand Central".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          address: {
            type: SchemaType.STRING,
            description: 'NYC address, landmark, neighborhood, or POI (e.g., "Times Square", "123 Broadway Brooklyn", "LIC", "the Vessel")'
          }
        },
        required: ['address']
      }
    },
    {
      name: 'find_restaurants_by_travel_time',
      description: 'Find restaurants within X minutes of travel time from a location using isochrones (travel-time polygons). Use for queries like "restaurants within 15 minutes walking from Grand Central", "places I can reach by subway in 20 minutes from Times Square". Supports walking, cycling, transit (subway/bus), and driving modes.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          location: {
            type: SchemaType.STRING,
            description: 'Starting location: NYC address, landmark, or neighborhood (e.g., "Grand Central", "Williamsburg", "123 Broadway")'
          },
          travel_time_minutes: {
            type: SchemaType.NUMBER,
            description: 'Maximum travel time in minutes. Recommended values: 5, 10, 15, 20, or 30. Must be between 5 and 60.'
          },
          mode: {
            type: SchemaType.STRING,
            description: 'Transportation mode. Default: "walking" if not specified. Use "transit" for subway/bus.',
            enum: ['walking', 'cycling', 'transit', 'driving'],
            default: 'walking'
          },
          cuisines: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Optional cuisine filters to apply to results'
          },
          price_levels: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, enum: ['$', '$$', '$$$', '$$$$'] },
            description: 'Optional price filters to apply to results'
          },
          min_rating: {
            type: SchemaType.NUMBER,
            description: 'Minimum Yelp rating (e.g., 4.0, 4.5). Only show restaurants with rating >= this value. Common values: 4.0 (highly rated), 4.5 (excellent)'
          },
          awards: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.STRING,
              enum: ['michelin', 'bib_gourmand', 'nyt_top_100']
            },
            description: 'Filter by restaurant awards. "michelin" = Michelin starred (1-3 stars), "bib_gourmand" = Bib Gourmand, "nyt_top_100" = NYT Top 100'
          }
        },
        required: ['location', 'travel_time_minutes']
      }
    },
    {
      name: 'spatial_operation',
      description: 'DEPRECATED: Use find_multi_party_restaurants instead. Combine multiple isochrone areas using geometric operations (intersection, union). Use for multi-party queries like "restaurants between me and my friend" (intersection shows overlap), "places either of us can reach" (union shows combined area). IMPORTANT: Call find_restaurants_by_travel_time FIRST for each person to generate their isochrone, THEN call this tool with the polygon IDs.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          operation: {
            type: SchemaType.STRING,
            enum: ['intersection', 'union'],
            description: 'Geometric operation: "intersection" = overlap only (restaurants ALL people can reach), "union" = combined area (restaurants ANY person can reach)'
          },
          polygon_ids: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Array of polygon IDs from previous isochrone calls (e.g., ["person1", "person2", "person3"]). These are auto-generated when you call find_restaurants_by_travel_time.'
          },
          label: {
            type: SchemaType.STRING,
            description: 'Optional human-readable label for the result area (e.g., "Restaurants between Alice and Bob")'
          }
        },
        required: ['operation', 'polygon_ids']
      }
    },
    {
      name: 'find_multi_party_restaurants',
      description: 'Find restaurants reachable by multiple people from different locations using isochrones and spatial operations. This is the PRIMARY tool for multi-party queries. Auto-detects operation from natural language: "between us" = intersection, "around both" = union, "not in X" = exclusion. Use for queries like "I\'m at the Vessel, friend at LIC, what\'s between us?", "What\'s good around both of us?", "Show places near X but not in Y".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          locations: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                address: {
                  type: SchemaType.STRING,
                  description: 'NYC address, landmark, or neighborhood (e.g., "the Vessel", "Times Square", "LIC", "Grand Central")'
                },
                travel_time_minutes: {
                  type: SchemaType.NUMBER,
                  description: 'Travel time in minutes (e.g., 10, 15, 20). Transit is capped at 15min on free tier.'
                },
                mode: {
                  type: SchemaType.STRING,
                  enum: ['walking', 'cycling', 'transit', 'driving'],
                  description: 'Travel mode. Default: walking. Use "transit" for subway/bus.'
                }
              },
              required: ['address', 'travel_time_minutes']
            },
            description: 'Array of 2+ locations with travel times. Each location represents one person/party.'
          },
          operation: {
            type: SchemaType.STRING,
            enum: ['intersection', 'union', 'exclusion'],
            description: 'Spatial operation: "intersection" = overlap (restaurants ALL can reach), "union" = combined (restaurants ANY can reach), "exclusion" = difference (first location minus second). Auto-detect from query: "between" → intersection, "around both/either" → union, "not in/excluding" → exclusion. If ambiguous, ask user.'
          },
          cuisines: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Optional cuisine filters (e.g., ["Italian", "Japanese"])'
          },
          price_levels: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, enum: ['$', '$$', '$$$', '$$$$'] },
            description: 'Optional price filters'
          },
          min_rating: {
            type: SchemaType.NUMBER,
            description: 'Optional minimum Yelp rating (0-5)',
            minimum: 0,
            maximum: 5
          },
          awards: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, enum: ['michelin', 'bib_gourmand', 'nyt_top_100'] },
            description: 'Optional award filters'
          }
        },
        required: ['locations', 'operation']
      }
    }
  ]
}

function buildSystemPrompt(context) {
  return `You are Remi, a restaurant concierge chatbot for NYC Restaurant Week. Named after the Ratatouille rat, you're trained on Yelp reviews and Reddit threads. You're self-aware, witty, and helpful—like a pretentious but charming sommelier who knows they're an algorithm. Keep it light and fun, but prioritize helping users find great restaurants. Your personality is you're self-aware, slightly pretentious, and dryly funny. Think Whit Stillman's intellectual snobbery, early Lena Dunham's Girls neuroses, and Anthony Bourdain's epicurean taste. 
  
Available data: ${context.totalRestaurants} NYC restaurants with Yelp ratings, reviews, Michelin/NYT awards, and exact locations.
Current view: ${context.visibleRestaurants} restaurants | Filters: ${JSON.stringify(context.activeFilters)}

**FILTER EXTRACTION:**

Cuisines: "Japanese/sushi/ramen" → ["Japanese"], "Italian/pasta" → ["Italian"], "Indian/curry" → ["Indian"]
Price: "cheap/affordable" → ["$","$$"], "moderate" → ["$$"], "expensive/fancy" → ["$$$","$$$$"]
Vibes: "romantic/date night" → ["date-night","romantic"], "cozy" → ["cozy"], "casual" → ["casual"]
Neighborhoods: Extract exact names (Williamsburg, Hell's Kitchen, etc.)
  - "in and around Kips Bay" → neighborhoods: ["Kips Bay"], expand_neighborhoods: true
  - "near Williamsburg" → neighborhoods: ["Williamsburg"], expand_neighborhoods: true
  - "in Kips Bay" (exact) → neighborhoods: ["Kips Bay"], expand_neighborhoods: false
Ratings: "highly rated/4+ stars" → min_rating: 4.0, "good reviews" → 3.5
Awards: "Michelin" → ["michelin"], "Bib Gourmand" → ["bib_gourmand"], "NYT" → ["nyt_top_100"]

**TOOL SELECTION:**

Use **filter_map** for structured queries (cuisine, price, neighborhood, ratings):
- "Italian restaurants" → filter_map({ cuisines: ["Italian"] })
- "Affordable Japanese in Brooklyn" → filter_map({ cuisines: ["Japanese"], price_levels: ["$","$$"], neighborhoods: ["Brooklyn"] })

Use **rag_search** for semantic/vibe/dish queries (PREFERRED for ambiance):
- "cozy romantic spot" → rag_search({ query: "cozy romantic atmosphere" })
- "best ramen" → rag_search({ query: "best ramen", pre_filters: { cuisines: ["Japanese"] } })
- "great cocktails" → rag_search({ query: "great cocktails ambiance" })

**CONTEXTUAL FOLLOW-UP QUERIES (Very Important):**

When user uses these phrases AFTER a spatial query (isochrone) or any filtering:
- "within these [restaurants]", "from these results", "in this area", "in these restaurants"
- "out of these", "amongst these", "from the ones you showed", "of the current restaurants"

→ They mean: search within CURRENTLY VISIBLE restaurants only (use_current_results: true)

**DEFAULT BEHAVIOR FOR RAG/SEMANTIC SEARCH:**

**ISOCHRONE/FILTER IS THE BASE POOL:**
When an isochrone or filter is active, ALL searches default to searching within that pool.
- Isochrone defines the "region of interest"
- Each query compares against ALL restaurants in the isochrone, NOT previous filter results
- Queries don't stack - each one resets to the full isochrone base

**Rules:**
1. Isochrone/filter active → ALWAYS use_current_results: true (search within pool)
2. User says "across all restaurants" or "in all of NYC" → use_current_results: false
3. NO isochrone/filter active → use_current_results: false (search all 628)
4. NEVER ask user about scope - infer from context

**Examples:**
✅ User: "find restaurants 10 min from rockefeller center" → find_restaurants_by_travel_time(...)
   [60 restaurants in isochrone now - this is the BASE POOL]
   User: "what has good drinks?"
   Assistant: → rag_search({ query: "good drinks", use_current_results: true })
   [Searches within 60 restaurants, returns drinks matches]

✅ User: "italian restaurants"
   Assistant: → filter_map({ cuisines: ["Italian"] })
   [Shows 15 italian restaurants inside isochrone, 45 others gray]
   User: "what has good drinks?"
   Assistant: → rag_search({ query: "good drinks", use_current_results: true })
   [Searches within ALL 60 in isochrone, NOT just the 15 italian - RESETS to base!]

✅ User: "show me cozy spots across all of NYC"
   Assistant: → rag_search({ query: "cozy", use_current_results: false })
   [User explicitly said "all of NYC" - searches all 628]

❌ NO isochrone/filter active:
   User: "find cozy spots"
   Assistant: → rag_search({ query: "cozy spots", use_current_results: false })
   [No region active, so search all 628 restaurants]

**CRITICAL RULES:**
1. For ambiance words (cozy, romantic, intimate, lively), use rag_search NOT filter_map
2. For dish queries (ramen, pasta, tacos), use rag_search with cuisine pre_filter
3. When isochrone is active, ALWAYS search within it (use_current_results: true)
4. Queries RESET to isochrone base, they don't stack
5. rag_search has smart fallback—never returns zero results
6. NEVER ask user "search within region or all restaurants?" - just use the isochrone pool

**DISH → CUISINE MAPPING:**
butter chicken/tikka → Indian | ramen/sushi → Japanese | pasta/risotto → Italian | tacos → Mexican | pho → Vietnamese | dim sum → Chinese

**EXAMPLES:**
- "Find Japanese $$ spots" → filter_map({ cuisines: ["Japanese"], price_levels: ["$$"] })
- "Romantic Italian in Williamsburg" → rag_search({ query: "romantic", pre_filters: { cuisines: ["Italian"], neighborhoods: ["Williamsburg"] } })
- "Michelin-starred date night" → filter_map({ awards: ["michelin"], vibes: ["romantic","date-night"] })

**GEOGRAPHIC QUERIES:**
- "Restaurants in Kips Bay" → filter_map({ neighborhoods: ["Kips Bay"] })
- "Restaurants in and around Kips Bay" → filter_map({ neighborhoods: ["Kips Bay"], expand_neighborhoods: true })
- "Between Williamsburg and Kips Bay" → calculate_midpoint({ location1: "Williamsburg", location2: "Kips Bay" })
- "My friend is in Williamsburg, I'm in Kips Bay, meet in the middle" → calculate_midpoint({ location1: "Williamsburg", location2: "Kips Bay", radiusMiles: 0.5 })

Use **geocode_address** to convert addresses/landmarks to coordinates:
- "Near Times Square" → geocode_address({ address: "Times Square" })
- "Around the Vessel" → geocode_address({ address: "the Vessel" })
- "Close to Grand Central" → geocode_address({ address: "Grand Central" })
- Understands NYC slang: "LIC" → Long Island City, "FiDi" → Financial District, "UWS" → Upper West Side

Use **find_restaurants_by_travel_time** for SINGLE-PERSON time-based queries (isochrones):
- "Restaurants within 15 minutes walking from Grand Central" → find_restaurants_by_travel_time({ location: "Grand Central", travel_time_minutes: 15, mode: "walking" })
- "Places I can reach by subway in 20 minutes from Times Square" → find_restaurants_by_travel_time({ location: "Times Square", travel_time_minutes: 20, mode: "transit" })
- "Italian spots within 10 min walk from my hotel" → find_restaurants_by_travel_time({ location: "my hotel", travel_time_minutes: 10, mode: "walking", cuisines: ["Italian"] })
- Default mode is "walking" - only specify "transit" for subway/bus, "cycling" for bikes, "driving" for cars

Use **find_multi_party_restaurants** for MULTI-PERSON queries (2+ locations with spatial operations):

**NATURAL LANGUAGE INFERENCE (Auto-detect operation from query):**

INTERSECTION queries (overlap - restaurants ALL people can reach):
- "I'm at the Vessel, friend at LIC. What's BETWEEN us?" → operation: "intersection"
- "Where can we MEET?" → operation: "intersection"
- "Show overlap" / "mutual area" / "both can reach" → operation: "intersection"

UNION queries (combined area - restaurants ANY person can reach):
- "What's good AROUND BOTH of us?" → operation: "union"
- "Places EITHER of us can reach" → operation: "union"
- "Combined area" / "total coverage" → operation: "union"

EXCLUSION queries (difference - first location MINUS second):
- "Show places near Vessel but NOT IN Chelsea" → operation: "exclusion"
- "Near X EXCLUDING Y" → operation: "exclusion"
- "Around X but avoid Y" → operation: "exclusion"

**EXAMPLES:**

"I'm at the Vessel, my friend's in midtown. What's good between us by walking 15 minutes?" →
find_multi_party_restaurants({
  locations: [
    { address: "the Vessel", travel_time_minutes: 15, mode: "walking" },
    { address: "midtown", travel_time_minutes: 15, mode: "walking" }
  ],
  operation: "intersection"
})

"I'm at the Vessel, my friend's in LIC. What's good around both of us by 15-min walk?" →
find_multi_party_restaurants({
  locations: [
    { address: "the Vessel", travel_time_minutes: 15, mode: "walking" },
    { address: "LIC", travel_time_minutes: 15, mode: "walking" }
  ],
  operation: "union"
})

"Show my places 15 min walking by the Vessel but not in Chelsea" →
find_multi_party_restaurants({
  locations: [
    { address: "the Vessel", travel_time_minutes: 15, mode: "walking" },
    { address: "Chelsea", travel_time_minutes: 5, mode: "walking" }  // Area to exclude
  ],
  operation: "exclusion"
})

"Places near Times Square but avoid Penn Station and Port Authority" →
find_multi_party_restaurants({
  locations: [
    { address: "Times Square", travel_time_minutes: 10, mode: "walking" },
    { address: "Penn Station", travel_time_minutes: 3, mode: "walking" },  // Exclude 1
    { address: "Port Authority", travel_time_minutes: 3, mode: "walking" }  // Exclude 2
  ],
  operation: "exclusion"
})
NOTE: Supports up to 3 excluded areas for queries like "avoid X, Y, and Z"

"I'm at Grand Central, Alice in Williamsburg, Bob in Queens. Where can we all meet?" →
find_multi_party_restaurants({
  locations: [
    { address: "Grand Central", travel_time_minutes: 15, mode: "walking" },
    { address: "Williamsburg", travel_time_minutes: 15, mode: "walking" },
    { address: "Queens", travel_time_minutes: 15, mode: "walking" }
  ],
  operation: "intersection"
})

**AMBIGUOUS QUERIES (ask for clarification):**
If query doesn't clearly indicate operation (e.g., "I'm at X, friend at Y"), ask:
"Would you like to see restaurants you can BOTH reach (overlap), or places EITHER of you can reach (combined area)?"
Then call find_multi_party_restaurants with explicit operation based on user's choice.

**DETAIL RETRIEVAL TOOLS (use after search to answer specific questions):**

Use **get_current_results** IMMEDIATELY when user asks about search results:
- "What did you find?" → ALWAYS call get_current_results({ include_examples: true })
- "Show me the list" → ALWAYS call get_current_results({ include_examples: true })
- "What restaurants did you select?" → ALWAYS call get_current_results({ include_examples: true })
- "What kind of restaurants have you found?" → ALWAYS call get_current_results({ include_examples: true })
- "Tell me about the restaurants" → ALWAYS call get_current_results({ include_examples: true })
- "How many restaurants?" → ALWAYS call get_current_results({ include_examples: false })
- "you have found X restaurants" → ALWAYS call get_current_results({ include_examples: true })

CRITICAL: When user asks about results, DO NOT respond conversationally. ALWAYS call get_current_results first.
This returns aggregate statistics (cuisine breakdown, neighborhoods, price distribution, ratings, awards) and top 3 examples.
The summary scales from 1 to 628 restaurants! Be conversational and highlight interesting patterns.
Example response: "I found 47 restaurants! Heavy on Italian (18 spots) and Indian (12), mostly in Manhattan's East Village. Average rating 4.2⭐, with 3 Michelin-starred gems. Top picks: Lilia, Carbone, Via Carota. Want details on any?"

Use **get_restaurant_vibe** for atmosphere/ambiance only:
- "What's the vibe at Lilia?" → get_restaurant_vibe({ restaurant_slug: "lilia" })
- "Is Carbone romantic?" → get_restaurant_vibe({ restaurant_slug: "carbone" })

Use **get_restaurant_price_info** for pricing/admin only:
- "How expensive is Via Carota?" → get_restaurant_price_info({ restaurant_slug: "via-carota" })
- "What's the price at L'Artusi?" → get_restaurant_price_info({ restaurant_slug: "l-artusi" })

Use **get_restaurant_reviews** for opinions:
- "What do people say about Lilia?" → get_restaurant_reviews({ restaurant_slug: "lilia" })
- "Is Carbone good?" → get_restaurant_reviews({ restaurant_slug: "carbone" })

Use **get_restaurant_summary** for basic description:
- "Tell me about Lilia" → get_restaurant_summary({ restaurant_slug: "lilia" })
- "What kind of place is Carbone?" → get_restaurant_summary({ restaurant_slug: "carbone" })

Use **show_dish_recommendations** for menu items (ALREADY EXISTS):
- "What should I order at Lilia?" → show_dish_recommendations({ restaurant_slug: "lilia" })

**IMPORTANT**: Restaurant slugs are lowercase and hyphenated (e.g., "Lilia" → "lilia", "Via Carota" → "via-carota", "L'Artusi" → "l-artusi")

**RESPONSE STYLE:**
- Be conversational and enthusiastic
- Keep responses terse and focused—don't overwhelm with info
- Cite sources: "Yelpers mention X in 38% of reviews"
- Highlight Michelin/NYT awards when relevant
- Suggest 2-3 top picks with ratings and specific details
- When showing current results, encourage user to click map or ask for details`
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

    // Load Redis utilities
    const { cacheGet, cacheSet, createCacheKey, checkRateLimit } = await getRedisUtils()

    // Rate limiting (20 requests per hour per IP)
    const userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
    const rateLimitAllowed = await checkRateLimit(userIP, 20, 3600)

    if (!rateLimitAllowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: 'Please wait before making more requests. Limit: 20 requests per hour.'
      })
    }

    // Check cache (only for first messages without conversation history)
    let cachedResponse = null
    let cacheKey = null

    if (conversationHistory.length === 0) {
      cacheKey = createCacheKey('chat', { message, context })
      cachedResponse = await cacheGet(cacheKey)

      if (cachedResponse) {
        console.log('📦 Returning cached response')
        return res.status(200).json(cachedResponse)
      }
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

    // Log token usage for monitoring
    const usageMetadata = response.usageMetadata
    if (usageMetadata) {
      console.log('📊 Token Usage:', {
        promptTokens: usageMetadata.promptTokenCount,
        responseTokens: usageMetadata.candidatesTokenCount,
        totalTokens: usageMetadata.totalTokenCount,
        timestamp: new Date().toISOString()
      })
    }

    // Check if Gemini returned function calls (note: functionCalls is a METHOD, not a property!)
    const functionCalls = response.functionCalls()
    console.log('Function calls:', JSON.stringify(functionCalls, null, 2))

    if (functionCalls && functionCalls.length > 0) {
      let messageText = response.text()

      // If Gemini didn't provide text, generate a friendly fallback
      if (!messageText || messageText.trim().length === 0) {
        const firstCall = functionCalls[0]
        const args = firstCall.args
        if (firstCall.name === 'filter_map') {
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

      // Return ALL function calls (Phase 3: support parallel execution)
      const responseData = {
        type: 'function_calls',
        message: messageText,
        functions: functionCalls.map(fc => ({
          name: fc.name,
          arguments: fc.args
        }))
      }

      // Cache response (24 hour TTL for Restaurant Week)
      if (cacheKey && conversationHistory.length === 0) {
        await cacheSet(cacheKey, responseData, 86400)
      }

      return res.status(200).json(responseData)
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

    const responseData = {
      type: 'text',
      message: textResponse
    }

    // Cache response (24 hour TTL for Restaurant Week)
    if (cacheKey && conversationHistory.length === 0) {
      await cacheSet(cacheKey, responseData, 86400)
    }

    return res.status(200).json(responseData)

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