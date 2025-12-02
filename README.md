# NYC Eats

NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   User Interface                │
│  (React + TypeScript + Vite + Mapbox GL)       │
└──────────────────┬──────────────────────────────┘
                   │
                   ├─── Frontend Components
                   │    ├── App.tsx (main app, filter logic)
                   │    ├── Map.tsx (Mapbox integration)
                   │    ├── ChatInterface.tsx (Remi chatbot UI)
                   │    ├── Filters.tsx (filter controls)
                   │    └── RestaurantCard.tsx (detail view)
                   │
                   ├─── Data Layer
                   │    └── FinalData.json (628 restaurants)
                   │
                   └─── API Layer
                        └── /api/chat.js
                             │
                             ▼
                   ┌─────────────────────┐
                   │   Google Gemini AI  │
                   │  (Natural Language  │
                   │   Understanding)    │
                   └─────────────────────┘
```

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Mapbox GL JS** - Interactive maps
- **Turf.js** - Geospatial calculations (free, client-side)
- **CSS3** - Styling with glass morphism effects

### Backend
- **Vercel Edge Functions** - Serverless API hosting
- **Google Gemini 2.0 Flash Exp** - AI with function calling (free tier: 15 RPM, 1M tokens/day)
- **Pinecone** - Vector database for RAG search
- **Redis** (optional) - Caching layer for production
- **Node.js** - Runtime

### Data
- **Static JSON** - 628 restaurants with Yelp reviews, Reddit sentiment, Michelin/NYT awards, coordinates
- **Vector Embeddings** - Pre-computed semantic embeddings for RAG search


## How the AI Chatbot Works

### Architecture: Function Calling Pattern

The chatbot uses **Gemini's Function Calling** feature - a structured way for AI to execute actions. The backend **never sends restaurant data** to Gemini. Instead, Gemini receives conversation history and returns **function calls** that the frontend executes locally.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Input                                               │
│    "Find Japanese restaurants with $$"                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend (ChatInterface.tsx)                             │
│    POST /api/chat                                           │
│    Body: {                                                  │
│      message: "Find Japanese restaurants with $$",         │
│      conversationHistory: [...previous messages],          │
│      context: { totalRestaurants: 628, visible: 168 }      │
│    }                                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Backend (api/chat.js)                                    │
│    ┌─────────────────────────────────────────────────┐    │
│    │ Gemini receives:                                │    │
│    │ • System prompt (personality, tool usage rules) │    │
│    │ • 10 tool definitions (filter_map, etc.)        │    │
│    │ • Conversation history (last 20 messages)       │    │
│    │ • User's new message                            │    │
│    │                                                  │    │
│    │ Gemini DOES NOT receive:                        │    │
│    │ ❌ Restaurant data                               │    │
│    │ ❌ Search results                                │    │
│    │ ❌ Map state                                     │    │
│    └─────────────────────────────────────────────────┘    │
│                                                             │
│    Gemini decides which tool to call based on query        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Gemini Returns Function Call                             │
│    {                                                        │
│      type: 'function_call',                                │
│      function: {                                           │
│        name: 'filter_map',                                 │
│        arguments: {                                        │
│          cuisines: ['Japanese'],                           │
│          price_levels: ['$$']                              │
│        }                                                   │
│      }                                                     │
│    }                                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Frontend Executes Function (ChatInterface.tsx)           │
│    switch (function.name) {                                │
│      case 'filter_map':                                    │
│        onFilterChange('Cuisine', ['Japanese'])             │
│        onFilterChange('Price', ['$$'])                     │
│        // Updates App.tsx state                            │
│    }                                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. App.tsx Filters Restaurants (Client-Side)                │
│    filtered = restaurants.filter(r => {                    │
│      return r.cuisine.includes('Japanese') &&              │
│             r.price === '$$'                               │
│    })                                                      │
│    // Result: ~15 restaurants                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Map.tsx Updates Display                                  │
│    • Shows only filtered restaurant markers                │
│    • User sees results instantly                           │
└─────────────────────────────────────────────────────────────┘
```

### Key Points

1. **Gemini only receives**:
   - User query + conversation history
   - System prompt with tool usage instructions
   - Context metadata (counts, not data)

2. **Gemini returns**:
   - Function/tool call name
   - Structured arguments
   - Natural language response

3. **Frontend executes**:
   - All function calls happen locally
   - No restaurant data sent to Gemini
   - Results computed client-side

4. **Why this architecture?**
   - ✅ **Zero token cost** for restaurant data (628 restaurants would be huge!)
   - ✅ **Privacy**: Restaurant data never leaves the browser
   - ✅ **Speed**: Local filtering is instant
   - ✅ **Offline-capable**: Static data works without API

---

## Current Architecture Limitations

### 🚨 Known Issues (To Be Fixed in LangChain Migration)

The current architecture has **3 critical limitations** that impact user experience:

#### 1. **❌ No Conversation Memory Persistence**
**Problem:** Each query is essentially stateless. Conversation history length shows as `1`, meaning only the current message is sent to Gemini.

**Impact:**
- Follow-up questions don't work well ("What about Italian?" after "Show me restaurants in Soho")
- Agent can't reference previous tool results
- No multi-turn reasoning

**Example:**
```
User: "Find Indian restaurants in Soho"
Bot: [Returns 0 results via rag_search]
User: "Try nearby neighborhoods"
Bot: ❌ Doesn't remember the previous query context
```

**Root cause:** Conversation history isn't properly maintained across API calls in `api/chat.js` and `ChatInterface.tsx`.

---

#### 2. **❌ No Multi-Tool Orchestration (Single Tool Per Turn)**
**Problem:** Gemini can only call ONE tool per conversation turn. If that tool fails or returns insufficient results, the flow stops.

**Impact:**
- Can't chain tools automatically ("search Soho → 0 results → broaden search → find nearby")
- Manual orchestration code in 5 tools (257 lines in `find_multi_party_restaurants` alone!)
- Workaround flags like `use_current_results` exist because tools can't naturally access context

**Example:**
```
User: "I want butter chicken in Soho"
Bot: Calls rag_search(query="butter chicken", neighborhood="Soho")
Result: 0 restaurants
Bot: ❌ Stops here. Doesn't automatically try broader search or suggest nearby areas.
```

**What SHOULD happen:**
```
User: "I want butter chicken in Soho"
Bot: Call 1 - rag_search(Soho filter) → 0 results
Bot: Call 2 - rag_search(no location filter) → 15 results nearby
Bot: Call 3 - isochrone_analysis(Soho, 10min) → Show walking distance
Response: "No butter chicken directly in Soho, but here are 15 nearby spots within 10min walk..."
```

---

#### 3. **❌ No Quality Assurance / Validation Loop**
**Problem:** Gemini doesn't verify if tool results actually satisfy the user's query.

**Impact:**
- No retry logic if tools fail
- No validation that results match user intent
- Non-deterministic responses (same query can give different tool calls due to temperature > 0)

**Example:**
```
User: "I want good butter chicken spots in Soho"

Attempt 1: Calls rag_search → correct tool
Attempt 2: Calls semantic_search → wrong tool (less accurate)
Attempt 3: Returns "buy me coffee" message → hallucination

Same input → 3 different outputs ❌
```

**Root cause:**
- No `temperature=0` setting (responses are random)
- No validation layer asking "Did this satisfy the query?"
- No retry/fallback mechanisms

---

### Why These Matter

These limitations make the chatbot feel:
- **Generic** (like ChatGPT, not NYC-specific)
- **Fragile** (single tool failures break the experience)
- **Unpredictable** (same query → different results)

**Solution:** Migrate to **LangChain** for native multi-tool orchestration, conversation memory, and validation hooks. See [Next Steps](#next-steps-langchain-migration) below.

---

## Available Tools (16 Total)

Gemini has access to **16 function tools** it can call based on user queries. These tools are executed **client-side** by the frontend.

**Note:** Some tools are redundant (exist only due to single-tool limitation). See [cleanup plan](#tool-cleanup-plan) below.

### 🔍 Search & Filter Tools (3)

#### 1. `filter_map`
**Purpose**: Multi-criteria restaurant filtering with smart highlighting
**Parameters**:
- `cuisines`: Array of cuisine types (e.g., `["Japanese", "Italian"]`)
- `price_levels`: Array of price points (`["$", "$$", "$$$", "$$$$"]`)
- `neighborhoods`: Array of neighborhoods
- `expand_neighborhoods`: Boolean - include adjacent areas
- `vibes`: Array of collection tags (`["date-night", "romantic", "cozy"]`)
- `awards`: Array of awards (`["michelin", "bib_gourmand", "nyt_top_100"]`)
- `min_rating`: Minimum Yelp rating (0-5)
- `semantic_features`: Array of keywords to search in review highlights

**Behavior**: Highlights matching restaurants with pink markers while keeping all restaurants visible. Respects active isochrone regions.

**Example**:
```javascript
filter_map({
  cuisines: ["Japanese"],
  price_levels: ["$$"],
  neighborhoods: ["Williamsburg"],
  expand_neighborhoods: true,
  min_rating: 4.0
})
```

#### 2. `semantic_search`
**Purpose**: Unstructured keyword-based search in reviews
**Parameters**:
- `query`: Search query
- `keywords`: Array of keywords to search for
- `pre_filters`: Optional filters (cuisine, price, etc.)
- `use_current_results`: Boolean - scope to isochrone region if active (default: true)

**Behavior**: Highlights matching restaurants with pink markers while keeping all restaurants visible

**Example**:
```javascript
semantic_search({
  query: "great cocktails",
  keywords: ["cocktails", "drinks"],
  pre_filters: { neighborhoods: ["East Village"] }
})
```

#### 3. `rag_search`
**Purpose**: AI-powered semantic search using vector embeddings (Pinecone)
**Parameters**:
- `query`: Natural language query
- `pre_filters`: Optional filters
- `top_k`: Number of results (default: 20)
- `use_current_results`: Boolean - scope to isochrone region if active (default: true)

**Behavior**: Highlights matching restaurants with pink markers while keeping all restaurants visible. Works seamlessly within active isochrone regions.

**Example**:
```javascript
rag_search({
  query: "cozy romantic atmosphere for a date",
  top_k: 10
})
```

---

### 📊 Context & Detail Tools (9)

#### 5. `get_current_results`
**Purpose**: Get intelligent summary of currently visible restaurants with aggregate statistics
**Parameters**:
- `include_examples`: Boolean - include top 3 restaurant names (default: true)

**Returns**: Metadata summary that scales from 1 to 628 restaurants:
- Total count
- Cuisine breakdown
- Borough/neighborhood distribution
- Price distribution
- Average rating
- Awards count (Michelin, NYT)
- Top 3 examples

**Example**:
```javascript
get_current_results({ include_examples: true })

// Returns summary:
// "I've found 47 restaurants for you. Top-rated restaurants are Lilia, Carbone, Via Carota!
//  Here's a further breakdown:
//  Top Cuisines: Italian, Indian, Japanese
//  Top Neighborhoods: East Village, Williamsburg, West Village
//  Price distribution: 5 $, 20 $$, 18 $$$, 4 $$$$
//  Average rating: 4.2⭐
//  Awards: 3 Michelin-starred
// If you want to learn more, click on a restaurant with a pink marker or ask me questions.
```

#### 6. `show_dish_recommendations`
**Purpose**: Get popular dishes/drinks from Yelp reviews for a specific restaurant
**Parameters**:
- `restaurant_slug`: Restaurant identifier (e.g., `"lilia"`)

**Example**:
```javascript
show_dish_recommendations({ restaurant_slug: "lilia" })
```

#### 7. `get_restaurant_vibe`
**Purpose**: Get atmosphere/ambiance description ONLY
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Only `yelp_review_highlights` field

**Example**:
```javascript
get_restaurant_vibe({ restaurant_slug: "carbone" })
```

#### 8. `get_restaurant_price_info`
**Purpose**: Get pricing and administrative details ONLY
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Price, neighborhood, address, phone, delivery/takeout info

**Example**:
```javascript
get_restaurant_price_info({ restaurant_slug: "via-carota" })
```

#### 9. `get_restaurant_reviews`
**Purpose**: Get what people think (Yelp + Reddit)
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Yelp review highlights + Reddit mentions

**Example**:
```javascript
get_restaurant_reviews({ restaurant_slug: "lilia" })
```

#### 10. `get_restaurant_summary`
**Purpose**: Get basic description and concept
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Summary, cuisine, location, rating, awards

**Example**:
```javascript
get_restaurant_summary({ restaurant_slug: "l-artusi" })
```

#### 11. `get_restaurant_reddit`
**Purpose**: Get ONLY Reddit mentions (no Yelp)
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Reddit community opinions only

**Note:** ⚠️ **Redundant tool** - Exists because model couldn't chain `get_restaurant_reviews` → extract Reddit section. Will be removed in LangChain migration.

**Example**:
```javascript
get_restaurant_reddit({ restaurant_slug: "lilia" })
```

#### 12. `get_restaurant_yelp_review`
**Purpose**: Get ONLY Yelp review highlights (no Reddit)
**Parameters**:
- `restaurant_slug`: Restaurant identifier

**Returns**: Yelp review highlights only

**Note:** ⚠️ **Redundant tool** - Exists because model couldn't chain `get_restaurant_reviews` → extract Yelp section. Will be removed in LangChain migration.

**Example**:
```javascript
get_restaurant_yelp_review({ restaurant_slug: "carbone" })
```

---

### 🗺️ Geospatial Tools (4)

#### 13. `calculate_midpoint`
**Purpose**: Find restaurants at the TRUE geographic midpoint between two NYC locations using simple radius search (API-free)
**Parameters**:
- `location1`: Neighborhood name (e.g., `"Williamsburg"`)
- `location2`: Neighborhood name (e.g., `"Kips Bay"`)
- `radiusMiles`: Search radius from midpoint (default: 1.0 mile)
- `cuisines`: Optional cuisine filters
- `price_levels`: Optional price filters

**How it works**:
- Calculates true geographic midpoint using Turf.js
- Finds restaurants within radius of midpoint
- Sorts by "balance score" (equal distance from both locations)
- No API calls - uses client-side Turf.js only

**Example**:
```javascript
calculate_midpoint({
  location1: "Williamsburg",
  location2: "Kips Bay",
  radiusMiles: 1.0,
  cuisines: ["Italian"]
})
```

#### 14. `geocode_address`
**Purpose**: Convert NYC addresses, landmarks, or POIs to coordinates for spatial queries. Understands NYC slang (LIC, FiDi, UWS, etc.).
**Parameters**:
- `address`: NYC address, landmark, neighborhood, or POI (e.g., "Times Square", "123 Broadway Brooklyn", "LIC", "the Vessel")

**Example**:
```javascript
geocode_address({ address: "Times Square" })
geocode_address({ address: "LIC" })  // Expands to "Long Island City"
```

#### 15. `find_restaurants_by_travel_time`
**Purpose**: Find restaurants within X minutes of travel time from a location using isochrones (travel-time polygons). Supports walking, cycling, transit (subway/bus), and driving modes.
**Parameters**:
- `location`: Starting location (address, landmark, or neighborhood)
- `travel_time_minutes`: Maximum travel time (5-60 minutes)
- `mode`: Transportation mode (`walking`, `cycling`, `transit`, `driving`). Default: `walking`
- `cuisines`: Optional cuisine filters
- `price_levels`: Optional price filters
- `min_rating`: Optional minimum Yelp rating
- `awards`: Optional award filters

**Example**:
```javascript
find_restaurants_by_travel_time({
  location: "Grand Central",
  travel_time_minutes: 15,
  mode: "walking"
})

find_restaurants_by_travel_time({
  location: "Times Square",
  travel_time_minutes: 20,
  mode: "transit",
  cuisines: ["Italian"],
  min_rating: 4.0
})
```

#### 16. `find_multi_party_restaurants`
**Purpose**: Find restaurants reachable by multiple people from different locations. Auto-detects spatial operation from natural language: "between us" = intersection, "around both" = union, "not in X" = exclusion. Supports 2+ locations.
**Parameters**:
- `locations`: Array of location objects, each with:
  - `address`: NYC address, landmark, or neighborhood
  - `travel_time_minutes`: Travel time in minutes
  - `mode`: Transportation mode (optional, defaults to walking)
- `operation`: Spatial operation (`intersection`, `union`, `exclusion`)
- `cuisines`: Optional cuisine filters
- `price_levels`: Optional price filters
- `min_rating`: Optional minimum rating
- `awards`: Optional award filters

**Example**:
```javascript
// Find overlap (restaurants BOTH can reach)
find_multi_party_restaurants({
  locations: [
    { address: "the Vessel", travel_time_minutes: 15, mode: "walking" },
    { address: "LIC", travel_time_minutes: 15, mode: "walking" }
  ],
  operation: "intersection"
})

// Find combined area (restaurants EITHER can reach)
find_multi_party_restaurants({
  locations: [
    { address: "Grand Central", travel_time_minutes: 10 },
    { address: "Penn Station", travel_time_minutes: 10 }
  ],
  operation: "union",
  cuisines: ["Japanese"]
})

// Exclude an area
find_multi_party_restaurants({
  locations: [
    { address: "Times Square", travel_time_minutes: 15, mode: "walking" },
    { address: "Penn Station", travel_time_minutes: 5, mode: "walking" }
  ],
  operation: "exclusion"
})
```

---

### Tool Selection Logic

Gemini decides which tool to call based on:
1. **Query intent** - What is the user trying to do?
2. **Keywords** - Specific words trigger specific tools
3. **Conversation context** - Previous queries influence next tool choice

**Examples**:
- "Find Italian restaurants" → `filter_map`
- "What did you find?" → `get_current_results`
- "Tell me about Lilia" → `get_restaurant_summary`
- "What's the vibe?" → `get_restaurant_vibe`
- "Between Brooklyn and Manhattan" → `calculate_midpoint`
- "Romantic date night spot" → `rag_search` (semantic)
- "Near Times Square" → `geocode_address`
- "Restaurants within 15 min walk from Grand Central" → `find_restaurants_by_travel_time`
- "I'm at the Vessel, friend at LIC, what's between us?" → `find_multi_party_restaurants`

## Example Queries

```
"Find Japanese restaurants with $$"
→ filter_map({ cuisines: ["Japanese"], price_levels: ["$$"] })

"Show me Michelin-starred date night spots"
→ filter_map({ awards: ["michelin"], vibes: ["date-night", "romantic"] })

"Italian restaurants in Williamsburg with great pasta"
→ rag_search({ query: "great pasta", pre_filters: { cuisines: ["Italian"], neighborhoods: ["Williamsburg"] } })

"Restaurants within 15 minutes walking from Grand Central"
→ find_restaurants_by_travel_time({ location: "Grand Central", travel_time_minutes: 15, mode: "walking" })

"I'm at the Vessel, my friend's in LIC. What's good between us?"
→ find_multi_party_restaurants({ locations: [...], operation: "intersection" })

"Show places near Times Square but avoid Penn Station"
→ find_multi_party_restaurants({ locations: [...], operation: "exclusion" })
```


## Key Technical Decisions

### 1. Client-Side Filtering
All filtering happens in the browser for instant results. The AI chatbot only extracts filter criteria; it doesn't search the data.

### 2. Functional State Updates
Using `setActiveFilters(prev => ...)` ensures multiple filters can be applied in quick succession without race conditions.

```javascript
// Before: Race condition
onFilterChange('Cuisine', ['Japanese'])  // activeFilters = {}
onFilterChange('Price', ['$$'])          // activeFilters still {} → OVERWRITES!

// After: Functional update
setActiveFilters(prev => ({...prev, Cuisine: ['Japanese']}))
setActiveFilters(prev => ({...prev, Price: ['$$']}))  // Correctly combines
```

### 3. AND Logic for Multiple Filters
Different filter types are combined with AND logic:
- Restaurant must match ALL filter types
- Within a filter type, OR logic applies (e.g., "Japanese OR Italian")

### 4. Gemini Function Calling
Using Gemini's function calling feature ensures structured responses instead of parsing free-form text.


## Optional: Redis Setup

For production deployments with 500+ users:
1. Create Redis Cloud account (free tier: 30MB)
2. Add `REDIS_URL` environment variable
3. System automatically enables caching with graceful degradation
4. See API documentation for cache TTL configuration

---

## Next Steps: LangChain Migration

### 🎯 Goal
Fix the 3 core architecture issues:
1. ✅ Enable conversation memory persistence
2. ✅ Enable multi-tool orchestration
3. ✅ Add quality assurance validation

### 📋 Migration Plan (3-4 days)

#### **Phase 1: Minimal Tool Cleanup** (1 day)
Only changes required for LangChain to work:

**Tasks:**
1. **Refactor 3 tools to return JSON** (2 hours)
   - `get_current_results` → return structured data instead of prose
   - `get_restaurant_reviews` → return `{yelp: {...}, reddit: {...}}`
   - Keep everything else as-is

2. **Remove `use_current_results` flag** (1 hour)
   - Remove from `semantic_search` and `rag_search` definitions
   - LangChain memory will handle context instead

3. **Test tools still work** (30 mins)
   - Quick smoke test with Gemini
   - Ensure no regressions

**Deliverable:** 16 tools (no consolidation), 3 refactored to JSON

---

#### **Phase 2: LangChain Integration** (2-3 days)

**Day 1: Setup** (4 hours)
1. **Install LangChain** (15 mins)
   ```bash
   npm install langchain @langchain/google-genai
   ```

2. **Convert tools to LangChain format** (3 hours)
   - Create `src/services/chatService.ts`
   - Wrap all 16 tools in `DynamicTool` class
   - Define schemas for tool parameters

3. **Create basic agent** (45 mins)
   ```typescript
   import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
   import { createReactAgent } from "@langchain/langgraph/prebuilt";

   const llm = new ChatGoogleGenerativeAI({
     modelName: "gemini-2.0-flash-exp",
     temperature: 0 // ✅ Deterministic responses
   });

   const agent = createReactAgent({
     llm,
     tools: [...your16Tools],
     messageModifier: systemPrompt
   });
   ```

**Day 2-3: Integration** (6-8 hours)
4. **Replace chat endpoint** (3 hours)
   - Refactor `ChatInterface.tsx` to use LangChain agent
   - Remove old function calling handler code
   - Handle streaming responses

5. **Add conversation memory** (2 hours)
   ```typescript
   import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

   const messageHistory = new InMemoryChatMessageHistory();

   // Agent automatically maintains context
   await agent.invoke({
     messages: [...messageHistory.getMessages(), newMessage]
   });
   ```

6. **Test multi-tool scenarios** (2-3 hours)
   - "butter chicken in Soho" → should chain rag_search → rag_search broader
   - "restaurants between Midtown and Murray Hill" → should chain geocode → geocode → midpoint
   - "show current results" after isochrone → context should work
   - Verify conversation memory persists

**Deliverable:** Working LangChain agent with multi-tool chaining

---

#### **Phase 3: Validation & Polish** (1 day)

**Tasks:**
1. **Add basic validation** (2 hours)
   - Log tool execution chains for debugging
   - Add error handling for failed tools
   - Test edge cases

2. **Improve system prompt** (1 hour)
   - Add multi-tool orchestration guidance
   - Example: "After rag_search returns 0, try broader search"

3. **End-to-end testing** (2 hours)
   - Test 10 real user queries
   - Verify conversation memory works
   - Ensure responses feel natural

4. **Performance check** (1 hour)
   - Profile query times
   - Ensure no regressions

**Deliverable:** Production-ready LangChain chatbot

---

### Tool Cleanup Plan

**Tools to consolidate (AFTER LangChain works):**

#### **Remove 5 redundant tools** → Consolidate into 2
1. ❌ `get_restaurant_reddit` (remove)
2. ❌ `get_restaurant_yelp_review` (remove)
3. ✅ Keep `get_restaurant_reviews` → returns structured JSON with both

4. ❌ `get_restaurant_vibe` (remove)
5. ❌ `get_restaurant_price_info` (remove)
6. ❌ `get_restaurant_summary` (remove)
7. ✅ Create `get_restaurant_info(slug, focus)` → replaces 3 tools

8. ❌ `semantic_search` (remove - less accurate)
9. ✅ Keep `rag_search` (vector-based, more powerful)

**Result:** 16 tools → 11 cleaner tools

---

#### **Simplify 4 tools** (return JSON, not formatted text)
1. `get_current_results` - return stats object, not prose
2. `get_restaurant_reviews` - return `{yelp, reddit}` structure
3. `get_restaurant_info` - return structured data
4. `find_multi_party_restaurants` - reduce from 257 lines to ~80

---

#### **Split 2 complex tools** (FUTURE - not required for MVP)
1. **`filter_map`** (134 lines) → break into 5 atomic filters:
   - `filter_by_cuisine`
   - `filter_by_price`
   - `filter_by_rating`
   - `filter_by_awards`
   - `filter_by_neighborhood`

2. **`find_multi_party_restaurants`** (257 lines) → break into spatial ops:
   - `get_isochrone` (reusable)
   - `spatial_intersection`
   - `spatial_union`
   - `spatial_exclusion`

**Result (if fully decomposed):** 11 tools → 18 focused, composable tools

---

### What We're NOT Doing (Yet)

To keep scope manageable, we're deferring these enhancements:

#### ❌ **Not Doing in Initial Migration**
- Tool consolidation (keep all 16 tools initially)
- Splitting complex tools (`filter_map`, `find_multi_party_restaurants`)
- Removing redundant tools (`semantic_search`, detail tools)
- Advanced personality overhaul (minor prompt tweaks only)
- Advanced validation loops (basic validation only)
- Parallel tool execution optimization
- Streaming responses

**Reason:** Get LangChain working with minimal changes first, then optimize iteratively.

---

#### 💡 **Future Enhancements (After LangChain Stable)**
These can be added once core migration is complete:

**Voice Integration (1 week):**
- Add Web Speech API for MVP
- Migrate to OpenAI Whisper for production
- Real-time transcription
- Voice commands

**Multi-Borough Expansion (2-3 weeks):**
- Add Google Places API as discovery layer
- Hybrid data strategy (Google + Yelp/Reddit)
- Expand to Brooklyn, Queens, Bronx, Staten Island
- Cross-borough isochrone queries

**Data Enrichment:**
- Real-time hours/status from Google Places
- Photo galleries
- Menu integration
- Live wait times
- Michelin Guide / James Beard Awards

**Advanced LangChain Features:**
- Streaming tool execution (show progress)
- LangSmith observability (debug chains)
- Memory summarization (long conversations)
- Multi-agent patterns (research + recommendation agents)

---

### Success Criteria

**Must Have (Phase 1-3):**
- ✅ Multi-tool chaining works ("butter chicken in Soho" triggers 2-3 tool calls)
- ✅ Conversation memory persists (follow-up questions work)
- ✅ Deterministic responses (same query → same result with temperature=0)
- ✅ No regressions (all existing features still work)

**Nice to Have (Defer):**
- Response personality improvements
- Tool consolidation
- Advanced validation callbacks

---

## Future Enhancements

- [ ] Real-time reservation availability
- [ ] Real-time User reviews and ratings
- [ ] Dish photo gallery
- [ ] Restaurant comparison tool
- [x] Transit-time-based isochrone calculations
- [ ] Push notifications for favorite restaurants

---


## Credits

- Built by AP, in collaboration with Fulton Ring and Marauders.Earth
