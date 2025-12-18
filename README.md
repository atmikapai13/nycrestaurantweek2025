# NYC Eats

NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.

---

## Architecture Overview

```
User Message
    ↓
Frontend (ChatInterface.tsx) → POST /api/chat
    ↓
Backend (api/chat.js) → LangGraph Agent (api/langgraph/agent.js)
    ↓
Agent State Graph:
    callModel (Gemini) → callTools (ToolNode) → processToolResults → callModel (loop)
    ↓
Agent returns: { messages, visibleRestaurants, isochroneParams, mapActions }
    ↓
Frontend executes mapActions → Map updates
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
- **LangGraph** - Multi-tool orchestration and conversation memory
- **Google Gemini 2.0 Flash Exp** - AI model with function calling (free tier: 15 RPM, 1M tokens/day)
- **Pinecone** - Vector database for RAG search
- **Redis** (optional) - Caching layer for production
- **Node.js** - Runtime

### Data
- **Static JSON** - 628 restaurants with Yelp reviews, Reddit sentiment, Michelin/NYT awards, coordinates
- **Vector Embeddings** - Pre-computed semantic embeddings for RAG search


## How the AI Chatbot Works

### LangGraph Agent Architecture

The chatbot uses **LangGraph** for multi-tool orchestration and stateful conversation management. The agent can chain multiple tools together, maintain conversation context, and provide deterministic responses.

### Key Features

✅ **Conversation Memory**: Full message history persists across turns
✅ **Multi-Tool Orchestration**: Agent can call multiple tools per conversation turn
✅ **Deterministic Responses**: `temperature=0` ensures consistent behavior
✅ **Stateful Context**: Tracks visible restaurants, active filters, and isochrone regions

### Agent State Management

The LangGraph agent maintains several state variables:

- **`messages`**: Full conversation history (append-only)
- **`visibleRestaurants`**: Current working set of restaurants
- **`activeFilters`**: Currently applied filters (cuisine, price, etc.)
- **`isochroneParams`**: Active isochrone polygon + metadata (sticky until reset)
- **`lastToolResults`**: Metadata from most recent tool execution

### Tool Scoping Pattern

A key innovation is the **scoping pattern** - tools can operate on either:
1. The full dataset (628 restaurants)
2. The current visible set (e.g., restaurants within an isochrone)

**Example workflow:**
```
User: "Show me restaurants within 15 minutes of Times Square"
→ Agent calls create_isochrone()
→ 50 restaurants now in visibleRestaurants

User: "Which ones are Italian?"
→ Agent calls filter_restaurants({ cuisines: ["Italian"], scopeToIsochrone: true })
→ Searches within the 50 visible restaurants, NOT all 628
→ Returns 8 Italian restaurants, preserves isochrone visualization
```

This enables natural multi-turn refinement without losing geographic context.

---

## Available Tools (7 Total)

The LangGraph agent has access to **7 specialized tools** for restaurant discovery and geospatial analysis:

### 🔍 Search & Filter Tools

#### 1. `filter_restaurants`
Structured filtering by cuisine, price, neighborhood, awards, rating. Supports `scopeToIsochrone` to filter within visible set.

#### 2. `semantic_search_restaurants`
RAG-powered semantic search via Pinecone for vibe/ambiance queries ("cozy romantic spot"). Supports `scopeToIsochrone`.

### 🗺️ Geospatial Tools

#### 3. `create_isochrone`
Generate travel-time polygon from a location. Modes: walking, cycling, transit, driving. Can apply filters immediately.

#### 4. `find_meeting_point`
Multi-party isochrone intersection/union/exclusion. Supports 2+ locations with different travel times/modes.

### 📊 Context & Detail Tools

#### 5. `get_restaurant_details`
Fetch full restaurant info by name or slug. Uses fuzzy matching for typos and partial names.

#### 6. `get_current_results`
Summary of visible restaurants: count, cuisine breakdown, price distribution, avg rating, top examples.

#### 7. `reset_search`
Clear all state (isochrone, filters, visible restaurants).

## Example Queries

```
"Find Japanese restaurants with $$"
→ filter_restaurants({ cuisines: ["Japanese"], priceLevels: ["$$"] })

"Show me Michelin-starred date night spots"
→ filter_restaurants({ awards: ["michelin"] })
→ semantic_search_restaurants({ query: "romantic date night atmosphere" })

"Italian restaurants in Williamsburg with great pasta"
→ filter_restaurants({ cuisines: ["Italian"], neighborhoods: ["Williamsburg"] })
→ semantic_search_restaurants({ query: "great pasta" })

"Restaurants within 15 minutes walking from Grand Central"
→ create_isochrone({ location: "Grand Central", travelTimeMinutes: 15, mode: "walking" })

"I'm at the Vessel, my friend's in LIC. What's good between us?"
→ find_meeting_point({ locations: [{address: "the Vessel", ...}, {address: "LIC", ...}], operation: "intersection" })
```

## Development Commands

```bash
# Development
npm run dev                    # Start Vite dev server (port 5173)
npm run vercel-dev            # Start Vercel Functions locally (port 3000)

# Build & Deploy
npm run build                 # TypeScript compile + Vite build + copy CNAME
npm run deploy                # Deploy to GitHub Pages

# Linting
npm run lint                  # ESLint check

# Vector Embeddings (Pinecone RAG setup)
npm run embeddings:generate   # Generate embeddings from FinalData.json
npm run embeddings:upload     # Upload to Pinecone
npm run embeddings:setup      # Both generate + upload
```

## Environment Variables

**Backend** (Vercel):
```
GOOGLE_API_KEY=...           # Google Gemini API key
MAPBOX_ACCESS_TOKEN=...      # Mapbox API (geocoding, isochrones)
PINECONE_API_KEY=...         # Pinecone vector DB (RAG search)
PINECONE_INDEX_NAME=...      # Pinecone index name
REDIS_URL=...                # Optional: Redis for caching
```

**Frontend** (Vite):
```
VITE_MAPBOX_TOKEN=...        # Mapbox GL JS map rendering
```


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
