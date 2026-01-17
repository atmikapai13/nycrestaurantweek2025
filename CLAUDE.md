# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NYC Eats is a conversational geospatial restaurant discovery tool for Manhattan. It combines:
- **Frontend**: React + TypeScript + Vite + Mapbox GL for interactive mapping
- **Backend**: Vercel Functions with AI SDK + MCP (Model Context Protocol)
- **AI**: Google Gemini 2.5 Flash with streaming multi-tool function calling
- **Data**: 628 restaurants with Yelp reviews, Reddit sentiment, Michelin/NYT awards, coordinates

The project explores next-generation map agents: natural language geocoding, isochrone generation (travel-time polygons), multi-party location intersection, and semantic venue retrieval.

## Common Commands

```bash
# Development
npm run dev                    # Start Vite dev server (port 5173)
npm run api:dev               # Start API server locally with tsx (port 3001)
npm run vercel-dev            # Start Vercel Functions locally (port 3000)

# Build & Deploy
npm run build                 # TypeScript compile + Vite build
npm run deploy                # Deploy to GitHub Pages

# Linting
npm run lint                  # ESLint check

# Vector Embeddings (Pinecone RAG setup)
npm run embeddings:generate   # Generate embeddings from FinalData.json
npm run embeddings:upload     # Upload to Pinecone
npm run embeddings:setup      # Both generate + upload
```

## Architecture: AI SDK + MCP

### Core Architecture Pattern

```
User Message
    ↓
Frontend (ChatInterface.tsx) → POST /api/chat (streaming)
    ↓
Backend (api/chat.ts) → AI SDK streamText() + MCP Client
    ↓
Gemini 2.5 Flash calls tools via MCP protocol:
    - geocode → get_isoline → displayRestaurants (location queries)
    - semantic_search_restaurants → displayRestaurants (vibe/dietary queries)
    - execute_sql → displayRestaurants (structured queries)
    ↓
Streaming response with tool results → Frontend renders progressively
```

### Key Backend Components (api/)

- **`chat.ts`**: Main Hono endpoint with AI SDK integration, tool wrappers, system prompt
- **`env.ts`**: T3 Env type-safe environment variable configuration
- **`schemas/chat.ts`**: Zod validation schemas for chat requests
- **`utils/geometryOptimizer.ts`**: Simplifies GeoJSON polygons to reduce token usage (50KB → 500 bytes)
- **`utils/toolWrapper.ts`**: Wraps MCP tools with geometry optimization middleware
- **`lib/ragSearchLogic.ts`**: Local Pinecone-based semantic search (replaces MCP search_documents)

### Frontend Components (src/components/)

- **`ChatInterface.tsx`**: Main chat UI using AI SDK `useChat` hook, handles tool results and map actions
- **`Map.tsx`**: Mapbox GL map with marker rendering, isochrone visualization, point-in-polygon filtering
- **`FilterBar.tsx`**: UI filters (cuisine, price, awards) that scope backend queries via `filterPool`
- **`RestaurantCard.tsx`**: Restaurant detail cards with accordions for info, reviews, socials

## Tool System

### Available Tools

1. **`displayRestaurants`**: Show restaurant cards. ALWAYS called after any search/filter to render results.
2. **`semantic_search_restaurants`**: RAG-powered search via Pinecone for vibes/dietary queries ("cozy", "vegan")
3. **`geocode`** (MCP): Address → lat/lng conversion
4. **`get_isoline`** (MCP): Generate travel-time polygon (walking, transit, cycling, driving)
5. **`execute_sql`** (MCP): DuckDB spatial queries for structured filters (cuisine, price, awards)

### Tool Chaining Pattern

Location + vibe queries require multi-step tool calls:
```
"cozy spots near Times Square"
→ geocode("Times Square") → { lat, lng }
→ get_isoline(lat, lng, 15min) → { GEO_REF_ID, restaurantSlugs }
→ semantic_search_restaurants({ query: "cozy", scopeToSlugs: restaurantSlugs })
→ displayRestaurants({ restaurant_names: [...] })
```

### GEO_REF Pattern

Isochrone polygons are cached with short IDs to reduce token usage:
- `get_isoline` returns `GEO_REF_ABC123` instead of 50KB polygon
- SQL queries use `ST_GeomFromGeoJSON(GEO_REF_ABC123)`
- **IDs are request-scoped** - expire after each response, must re-call `get_isoline` for follow-ups

### Filter Pool Scoping

Frontend filter bar selections are passed as `filterPool` in request context:
- Tools automatically scope to `filterPool` when active
- `execute_sql` injects `WHERE slug IN (...)` clause
- `semantic_search_restaurants` accepts `scopeToSlugs` param from prior isochrone

## File Structure

```
api/
├── chat.ts                      # Main streaming endpoint (Hono + AI SDK)
├── env.ts                       # T3 Env configuration
├── server.ts                    # Local dev server
├── schemas/chat.ts              # Zod request validation
├── lib/ragSearchLogic.ts        # Pinecone semantic search
└── utils/
    ├── geometryOptimizer.ts     # Polygon simplification + caching
    └── toolWrapper.ts           # MCP tool middleware

src/
├── App.tsx                      # Main app, global state
├── components/
│   ├── ChatInterface.tsx        # Chat UI with AI SDK useChat hook
│   ├── Map.tsx                  # Mapbox GL map
│   ├── FilterBar.tsx            # Filter UI
│   └── RestaurantCard.tsx       # Restaurant detail cards
├── contexts/MapContext.tsx      # Isochrone layer management
├── services/chatService.ts      # API client (legacy, now uses useChat)
└── data/FinalData.json          # Restaurant dataset

DEPRECATED_LANGRAPH (api)/       # Old LangGraph implementation (archived)
```

## Environment Variables

Backend (api/):
```
GOOGLE_API_KEY=...              # Google Gemini API key
MCP_SERVER_URL=...              # MCP server endpoint (marauders-query-mcp)
MCP_API_KEY=...                 # MCP authentication
MCP_ANALYSIS_ID=...             # Dataset ID in MCP
PINECONE_API_KEY=...            # Pinecone vector DB (for local RAG)
PINECONE_INDEX_NAME=...         # Pinecone index name
```

Frontend (Vite, prefixed with `VITE_`):
```
VITE_MAPBOX_TOKEN=...           # Mapbox GL JS map rendering
```

## Map Marker Colors

Priority system (higher overrides lower):
1. **Orange (#FF9100)** - Selected restaurant
2. **Pink (#ff67b2)** - Favorites
3. **Red (#c81224)** - Award winners (Michelin/NYT)
4. **Grey (#928f8e)** - Default

## Fuzzy Restaurant Matching

`fuzzyMatchRestaurant()` in chat.ts uses 5-tier matching:
1. Exact slug match
2. Normalized name match (removes articles, "and", special chars)
3. Partial name match (substring)
4. Slug similarity match
5. Levenshtein distance (typo tolerance, threshold 2-3)

## Development Workflow

1. **Frontend only**: `npm run dev` (port 5173) - works with production API
2. **Full stack local**:
   - Terminal 1: Start MCP server (marauders-query-mcp)
   - Terminal 2: `npm run api:dev` (port 3001)
   - Terminal 3: `npm run dev` (port 5173)
3. **With Vercel**: `npm run vercel-dev` (port 3000)

**Hot reload**: Vite hot-reloads frontend. Backend requires restart (Ctrl+C, restart).

## Debugging Tips

**Tool not being called?**
- Check system prompt in `api/chat.ts` - query patterns table determines tool selection
- Verify tool descriptions encourage correct usage

**Isochrone not scoping?**
- Ensure `scopeToSlugs` is passed from `get_isoline` to `semantic_search_restaurants`
- Check console logs for `🗺️ Scoping semantic search to X restaurants from isochrone`

**Restaurants not displaying?**
- `displayRestaurants` MUST be called after any search tool
- Check `restaurant_names` array is being passed correctly

**Outside Manhattan errors?**
- `geocode` and `get_isoline` validate coordinates against Manhattan bounds
- Postcodes 100xx-102xx are Manhattan; others trigger coverage error

## Known Limitations

- **Manhattan only**: No Brooklyn, Queens, Bronx, Staten Island
- **Static data**: FinalData.json is manually curated
- **GEO_REF expiration**: IDs expire per request; follow-up queries need fresh isochrones
- **Rate limits**: Gemini has RPM limits; monitor console for 429 errors
