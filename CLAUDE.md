# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NYC Eats is a conversational geospatial restaurant discovery tool for Manhattan. It combines:
- **Frontend**: React + TypeScript + Vite + Mapbox GL for interactive mapping
- **Backend**: Vercel Edge Functions with LangGraph agent orchestration
- **AI**: Google Gemini 2.0 Flash with multi-tool function calling
- **Data**: 628 restaurants with Yelp reviews, Reddit sentiment, Michelin/NYT awards, coordinates

The project is a sandbox for next-generation map agents: natural language geocoding, isochrone generation (travel-time polygons), multi-party location intersection, and contextual venue retrieval.

## Common Commands

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

## Architecture: LangGraph Agent System

This project recently migrated from simple Gemini function calling to **LangGraph** for multi-tool orchestration and conversation memory.

### Core Architecture Pattern

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

### State Management (api/langgraph/state.js)

The agent maintains stateful context across turns:

- **`messages`**: Full conversation history (append-only)
- **`visibleRestaurants`**: Current working set of restaurants (replaced on each tool call)
- **`activeFilters`**: Currently applied filters (cuisine, price, etc.)
- **`isochroneParams`**: Active isochrone polygon + metadata (sticky until reset)
- **`lastToolResults`**: Metadata from most recent tool execution

**Key principle**: `visibleRestaurants` represents "currently relevant restaurants" - could be from isochrone spatial filtering, structured filters, or semantic search. Subsequent tools can **scope** to this set using `scopeToIsochrone: true`.

### Tool Scoping Pattern

Both `filter_restaurants` and `semantic_search_restaurants` support `scopeToIsochrone` parameter:

```javascript
// Step 1: Create isochrone (50 restaurants within 15-min walk)
createIsochrone({ location: "Times Square", travelTimeMinutes: 15 })
// → visibleRestaurants = [50 restaurants], isochroneParams = { polygon, ... }

// Step 2: Filter within isochrone (default: scopeToIsochrone = true)
filter_restaurants({ cuisines: ["Italian"] })
// → Searches within the 50 visible restaurants, NOT all 628
// → visibleRestaurants = [8 Italian restaurants]

// Step 3: Break out to full dataset
filter_restaurants({ cuisines: ["Japanese"], scopeToIsochrone: false })
// → Searches all 628 restaurants
// → visibleRestaurants = [80 Japanese restaurants]
```

**Critical**: When `scopeToIsochrone: true`, the agent middleware automatically preserves isochrone visualizations - tools don't need to handle this explicitly.

### Agent Prompt Rules (api/langgraph/agent.js)

The agent follows strict rules for filter removal vs. reset:

**REMOVE FILTER (keep isochrone):**
- "nevermind no italian" / "any cuisine" / "show me everything here"
- → Call `filter_restaurants` with NO filters but `scopeToIsochrone: true`
- → Shows all restaurants within the geographic constraint

**FULL RESET:**
- "start over" / "reset" / "clear the map"
- → Call `reset_search` tool
- → Clears isochrone + filters + all state

**BREAK OUT OF ISOCHRONE:**
- "italian across all of NYC" / "search everywhere"
- → Call `filter_restaurants` with `scopeToIsochrone: false`
- → Searches full dataset, removes isochrone

## File Structure

```
api/
├── chat.js                      # Vercel Function endpoint - LangGraph invocation
├── langgraph/
│   ├── agent.js                 # LangGraph StateGraph definition, system prompt
│   ├── state.js                 # Agent state schema (messages, visibleRestaurants, etc.)
│   ├── tools.js                 # 7 tools: filter, semantic search, isochrone, etc.
│   └── lib/
│       ├── ragSearchLogic.js    # Pinecone vector search
│       ├── geocodeLogic.js      # Geocoding (Mapbox API)
│       └── isochroneLogic.js    # Travel-time polygon generation (Mapbox API)
└── utils/
    └── dataLoader.js            # Load/filter FinalData.json, fuzzy name matching

src/
├── App.tsx                      # Main app, filter state management
├── components/
│   ├── ChatInterface.tsx        # Remi chatbot UI, /api/chat integration
│   ├── Map.tsx                  # Mapbox GL map, marker rendering, isochrone viz
│   └── RestaurantCard.tsx       # Restaurant detail modal
├── hooks/
│   └── useChatMap.ts            # Map action orchestration (highlightRestaurants, showIsochrone)
└── services/
    └── chatService.ts           # API client for /api/chat

public/
└── FinalData.json               # 628 restaurants (static data, loaded client-side)
```

## Tool Definitions (api/langgraph/tools.js)

All tools are LangChain `DynamicStructuredTool` instances. They return JSON with:
- **`restaurants`**: Array of matching restaurants (updates `visibleRestaurants`)
- **`mapActions`**: Array of map commands (e.g., `highlightRestaurants`, `showIsochrone`)
- **`count`**, **`summary`**, etc.: Metadata for agent response

### 7 Core Tools

1. **`filter_restaurants`**: Structured filters (cuisine, price, neighborhood, awards, rating)
   - Supports `scopeToIsochrone: true` (default) to filter within visible set
   - Isochrone preservation handled automatically by agent middleware

2. **`semantic_search_restaurants`**: RAG-powered semantic search via Pinecone
   - Supports `scopeToIsochrone: true` (default)
   - Use for vibe/ambiance queries ("cozy romantic spot")
   - Isochrone preservation handled automatically by agent middleware

3. **`create_isochrone`**: Generate travel-time polygon from a location
   - Modes: walking, cycling, transit, driving
   - Can apply filters immediately via `filters` parameter
   - Updates `isochroneParams` state (sticky)

4. **`find_meeting_point`**: Multi-party isochrone intersection/union/exclusion
   - Supports 2+ locations with different travel times/modes
   - Operations: `intersection` (overlap), `union` (combined), `exclusion` (avoid)

5. **`get_restaurant_details`**: Fetch full restaurant info by name or slug (fuzzy matching)
   - Supports exact slugs, full names, partial names, and typos
   - Returns name, cuisine, summary, rating, reviews, awards, address
   - Returns `restaurants` array to enable map highlighting

6. **`get_current_results`**: Summary of visible restaurants
   - Returns count, cuisine breakdown, price distribution, avg rating, top examples

7. **`reset_search`**: Clear all state (isochrone, filters, visible restaurants)

## Map Actions Protocol

Tools return `mapActions` array that the frontend executes via `useChatMap` hook:

```javascript
// Example from filter_restaurants when scoping to isochrone
mapActions: [
  {
    mapAction: 'showIsochrone',
    polygon: state.isochroneParams.polygon,
    fitBounds: false  // Don't re-center, preserve view
  },
  {
    mapAction: 'highlightRestaurants',
    slugs: ['lilia', 'carbone', ...],
    count: 17
  }
]
```

**Available map actions**:
- `highlightRestaurants`: Pink markers for matching restaurants
- `showIsochrone`: Display travel-time polygon (pink/purple fill)
- `showIsochroneLayer`: Multi-layer isochrones (for meeting point visualization)
- `fitBounds`: Auto-zoom to show all markers/polygons
- `reset_all`: Clear map (remove isochrones, reset highlights)

## Map Marker Color System (src/components/Map.tsx)

Markers use a 4-tier priority system:

1. **Purple (#8b4dfe, 10px, z-index:3)** - Selected restaurant (click to select, click again to deselect)
2. **Red (#c81224, 10px, z-index:2)** - Favorites when favorites mode is active
3. **Pink (#FF69B4, 10px, z-index:2)** - Highlighted restaurants (search results, filters)
4. **Grey (#7c7c7c, 6px, z-index:1)** - Default/unfiltered restaurants

**Favorites Mode Behavior**:
- When active: Only favorite markers shown (red), all grey markers hidden
- When inactive: All restaurants shown, favorites highlighted pink (if in search results)

**Isochrone Filtering**:
- Single isochrone: Only restaurants inside polygon rendered
- Multi-party isochrone: Only restaurants inside intersection/union rendered
- Restaurants outside isochrone boundaries are hidden (not shown as grey)

## Agent State & Context

The agent has **module-level state caching** (api/langgraph/agent.js):
```javascript
let currentAgentState = null;  // Cached for tools to access synchronously
```

Tools access state via:
```javascript
const { getCurrentAgentState } = await import('./agent.js');
const state = getCurrentAgentState();

if (state.visibleRestaurants && state.visibleRestaurants.length > 0) {
  // Scope to visible set
}
```

**State update flow**:
1. Tool executes → returns JSON with `restaurants`, `mapActions`
2. `processToolResults()` parses response → extracts state updates
3. State graph reducer merges updates → new state
4. `currentAgentState` cache updated for next tool call

## Critical Implementation Details

### 1. Fuzzy Restaurant Name Matching (utils/dataLoader.js)

`getRestaurantByNameOrSlug()` uses 5-tier fuzzy matching:

1. **Exact slug match** - Fast path for exact matches
2. **Normalized name match** - Handles articles ("the"), "and" vs "&", special chars
3. **Partial name match** - Substring matching ("atlantic" → "Atlantic Grill")
4. **Slug similarity match** - Matches against slug fragments
5. **Levenshtein distance** - Typo tolerance (2-3 edit distance)

**Normalization**: Lowercase + remove leading articles (the, a, an) + remove "and" + remove special chars + collapse spaces

**Examples**:
- "the palm" → "The Palm - Midtown"
- "jardinier" → "Le Jardinier"
- "file gumbo" → "Filé Gumbo Bar"
- Backward compatible with exact slugs

### 2. Filter Scoping Logic (tools.js:64-88)

When `scopeToIsochrone: true`:
```javascript
let searchPool = null;
if (scopeToIsochrone) {
  const state = getCurrentAgentState();
  if (state.visibleRestaurants?.length > 0) {
    searchPool = state.visibleRestaurants;
  }
}

const filtered = searchPool
  ? applyFiltersManually(searchPool, { cuisines, priceLevels, ... })
  : filterData({ cuisines, priceLevels, ... });  // Full dataset
```

### 2. Isochrone Preservation Middleware (agent.js:376-434)

**CRITICAL ARCHITECTURAL PATTERN**: Isochrone preservation is handled by a **centralized middleware** in `processToolResults()`, NOT in individual tools. This prevents code duplication and ensures ALL tools (including future ones) automatically preserve isochrone visualizations.

**How it works:**
```javascript
// In agent.js, BEFORE extracting mapActions from tool results:
ensureIsochronePreservation(result, currentAgentState, msg.name);

// Middleware function checks:
// 1. Did tool already handle isochrone? (skip if yes)
// 2. Is isochrone active in state? (skip if no)
// 3. Did tool return restaurants? (skip if no - read-only query)
// 4. Auto-inject appropriate mapActions:
//    - Multi-party: All showIsochroneLayer actions (individual + combined polygons)
//    - Single: One showIsochrone action
```

**Why this pattern?**
- **DRY**: Logic written once, applies to ALL tools
- **Future-proof**: New tools automatically get isochrone preservation
- **Bug fix**: Even tools like `get_restaurant_details` now preserve isochrones
- **Cleaner tools**: Tools only return `highlightRestaurants`, middleware handles the rest

**Tools should NOT manually preserve isochrones** - the middleware handles it automatically.

### 3. Multi-Party Isochrone State Storage (agent.js:416-458)

Multi-party isochrones store complete layer data with metadata for visualization:

**Backend (agent.js)**:
```javascript
if (result.individualPolygons) {
  // Store ALL layers with metadata (individual + combined)
  const layers = [];

  // Individual polygon layers
  result.individualPolygons.forEach((polygon, index) => {
    layers.push({
      polygon,
      layerId: `person-${index + 1}`,
      color: index === 0 ? 'pink' : 'blue',
      label: `${result.locations[index].address} (${result.locations[index].travelTimeMinutes} min)`
    });
  });

  // Combined polygon layer
  layers.push({
    polygon: result.polygon,
    layerId: `${result.operation}-result`,
    color: 'purple',
    label: `${result.operation} area`
  });

  updates.isochroneLayers = layers;  // Stored for middleware reconstruction
  updates.isochroneParams = {
    polygon: result.polygon,
    allRestaurantSlugs: [...],  // Enables filtering
    operation: result.operation,
    locations: result.locations,
    isMultiParty: true  // Flag for middleware detection
  };
}
```

**Frontend (ChatInterface.tsx)**:
```typescript
if (onIsochroneRegion && response.isochrone_params.allRestaurantSlugs) {
  onIsochroneRegion(response.isochrone_params.allRestaurantSlugs);
}
```

The `isochroneLayers` array stores complete metadata so the middleware can reconstruct ALL polygon visualizations (individual + combined) after any tool call, ensuring multi-layer isochrones persist correctly.

### 4. Conversation Memory (agent.js:277-305)

LangGraph automatically maintains message history. Agent configuration:
```javascript
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-exp",
  temperature: 0  // Deterministic responses
});

const workflow = new StateGraph(AgentState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");
```

State persists across turns within a session. Frontend maintains conversation in `ChatInterface.tsx`.

## Environment Variables

Required for backend:
```
GOOGLE_API_KEY=...           # Google Gemini API key
MAPBOX_ACCESS_TOKEN=...      # Mapbox API (geocoding, isochrones)
PINECONE_API_KEY=...         # Pinecone vector DB (RAG search)
PINECONE_INDEX_NAME=...      # Pinecone index name
REDIS_URL=...                # Optional: Redis for caching
```

Frontend (in Vite, prefixed with `VITE_`):
```
VITE_MAPBOX_TOKEN=...        # Mapbox GL JS map rendering
```

## Testing Strategy

**Manual testing focus areas**:
1. **Multi-step refinement**: "15-min from Times Square" → "show me Italian" (should scope to isochrone)
2. **Filter removal**: "nevermind no italian" (should show all restaurants within isochrone)
3. **Breaking out**: "italian across all of NYC" (should remove isochrone, search full dataset)
4. **Conversation memory**: Follow-up questions should reference previous context
5. **Map visualization**: Isochrone polygon should persist when scoping, disappear when breaking out

**No automated tests** currently exist. Integration tests would be valuable for:
- Agent state management (scopeToIsochrone logic)
- Tool chaining scenarios
- Map action generation

## Known Limitations

1. **Manhattan only**: No Brooklyn, Queens, Bronx, Staten Island coverage
2. **Static data**: FinalData.json is manually curated, not real-time
3. **Single session memory**: Conversation history doesn't persist across page reloads
4. **No streaming responses**: Full response returned at once (LangGraph supports streaming but not implemented)
5. **Rate limits**: Gemini free tier = 15 RPM, 1M tokens/day
6. **Isochrone API costs**: Mapbox Isochrone API = $0.30/1000 requests (free tier: 100k/month)

## Development Workflow

1. **Frontend changes**: `npm run dev` (port 5173) + Vercel Functions not needed for UI work
2. **Backend changes**: `npm run vercel-dev` (port 3000) to test API locally
3. **Agent prompt updates**: Edit `api/langgraph/agent.js` → restart Vercel dev server
4. **Tool changes**: Edit `api/langgraph/tools.js` → restart Vercel dev server
5. **State schema changes**: Edit `api/langgraph/state.js` → may require resetting agent state

**Hot reload**: Vite hot-reloads frontend automatically. Vercel Functions require manual restart (Ctrl+C, restart).

## Debugging Tips

**Agent not scoping correctly?**
- Check backend console logs: Look for `🔭 Scoping filter to X visible restaurants` or `⚠️ No visibleRestaurants in agent state`
- Verify `isochroneParams.polygon` exists in state after `create_isochrone`
- Confirm `scopeToIsochrone` parameter is being passed (check tool call args in logs)

**Isochrone disappeared after filtering?**
- Check backend console logs for `🔄 AUTO: Preserved X layers in [tool_name]`
- Verify `ensureIsochronePreservation()` middleware is being called in `processToolResults()`
- For multi-party isochrones: Verify `isochroneLayers` array contains all layer metadata
- Verify `state.isochroneParams.isMultiParty` flag is set correctly

**Agent ignoring conversation context?**
- Verify message history is being passed correctly in `ChatInterface.tsx`
- Check that `processToolResults()` is extracting all state updates
- Ensure `currentAgentState` cache is being updated after each tool call

**Map actions not executing?**
- Check `useChatMap` hook in `ChatInterface.tsx` - map actions are executed via this hook
- Verify `mapActions` array format matches expected schema
- Check browser console for map rendering errors

## Future Migration Path

The README outlines a plan to migrate from the old function-calling architecture to LangGraph (now complete). Future enhancements:
- Voice integration (Web Speech API)
- Multi-borough expansion (Google Places API)
- Real-time data (hours, wait times, live menus)
- Streaming responses
- Advanced validation loops
