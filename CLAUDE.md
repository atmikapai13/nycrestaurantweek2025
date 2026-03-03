# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NYC Eats is a conversational geospatial restaurant discovery tool for Manhattan. It combines:
- **Frontend**: React 18 + TypeScript + Vite + Mapbox GL for interactive mapping
- **Backend**: Hono on Vercel Functions with AI SDK + MCP (Model Context Protocol)
- **AI**: Google Gemini 2.5 Flash with streaming multi-tool function calling
- **Search**: Pinecone vector DB for semantic search (hybrid 70% semantic + 30% keyword scoring)
- **Data**: 628 restaurants in `src/data/FinalData.json` with Yelp reviews, Reddit sentiment, Michelin/NYT awards, coordinates

## Common Commands

```bash
# Development
npm run dev                    # Vite frontend dev server (port 5173)
npm run api:dev               # API server with tsx watch (port 3001)
npm run vercel-dev            # Vercel Functions locally (port 3000)

# Build & Deploy
npm run build                 # tsc + vite build
npm run deploy                # Deploy to GitHub Pages via gh-pages

# Linting (no test suite configured)
npm run lint                  # ESLint check

# Vector Embeddings (Pinecone RAG)
npm run embeddings:generate   # Generate embeddings from FinalData.json
npm run embeddings:upload     # Upload to Pinecone
npm run embeddings:setup      # Both generate + upload
```

## Architecture

```
User Message
    ↓
ChatInterface.tsx → POST /api/chat (streaming)
    ↓
api/chat.ts → AI SDK streamText() + MCP Client
    ↓
Gemini calls tools via MCP protocol:
    - geocode → get_isoline → displayRestaurants (location queries)
    - semantic_search_restaurants → displayRestaurants (vibe/dietary queries)
    - execute_sql → displayRestaurants (structured filters)
    ↓
Streaming response with tool results → Frontend renders progressively
```

### Backend (api/)

- **`chat.ts`** (~1,591 lines): Central file — Hono endpoint, AI SDK streaming, system prompt (Remy from Ratatouille persona), all tool definitions, fuzzy restaurant matching
- **`server.ts`**: Local dev server using `@hono/node-server`, routes `/chat` and `/transcribe`, port 3001
- **`transcribe.ts`**: Audio transcription endpoint for voice input
- **`env.ts`**: T3 Env type-safe environment variables (Google API, MCP, Pinecone)
- **`schemas/chat.ts`**: Zod validation for UIMessage, message parts, tool invocations
- **`lib/ragSearchLogic.ts`** (~324 lines): Pinecone semantic search — `generateQueryEmbedding()`, `queryPinecone()`, `calculateKeywordBoost()`, `performRagSearch()`. Adaptive result count (10 if high quality, 5 if lower)
- **`utils/geometryOptimizer.ts`**: Simplifies GeoJSON polygons via Turf.js, creates `GEO_REF_*` cache IDs (50KB → 500 bytes)
- **`utils/toolWrapper.ts`**: Wraps MCP tools with geometry optimization middleware

### Frontend (src/)

- **`components/ChatInterface.tsx`** (~1,000 lines): Main chat UI using AI SDK `useChat` hook, handles tool results and map actions
- **`components/Map.tsx`**: Mapbox GL with markers, isochrone visualization, point-in-polygon filtering
- **`components/RestaurantCard.tsx`**: Restaurant detail cards with accordions
- **`components/RestaurantCarousel.tsx`**: Horizontal scrollable restaurant cards in chat
- **`components/FilterBar.tsx`** + **`FilterDropdown.tsx`**: Cuisine, price, awards, vibes filters that scope queries via `filterPool`
- **`components/FloatingHeader.tsx`**: Top UI bar
- **`components/IsochroneMessage.tsx`**: Isochrone display in chat
- **`contexts/MapContext.tsx`** (~551 lines): Central state — filter state (cuisine, price, awards, vibes, favorites, Yelp rating), isochrone layers, markers, search state, user geolocation, computed `filterPoolSlugs`
- **`types/restaurant.ts`**: Restaurant interface (name, slug, coordinates, cuisine, awards, Yelp data, socials, price, collections)

## Tool System

### Tools Defined in api/chat.ts

1. **`displayRestaurants`**: Render restaurant cards. MUST be called after any search/filter.
2. **`lookupRestaurant`**: Fuzzy match lookup for specific restaurants by name.
3. **`semantic_search_restaurants`**: RAG-powered search via Pinecone for vibes/dietary queries ("cozy", "vegan"). Accepts `scopeToSlugs` for isochrone scoping.
4. **`geocode`** (MCP): Address → lat/lng with Manhattan bounds validation.
5. **`get_isoline`** (MCP): Travel-time polygon (walking, transit, cycling, driving). Returns `GEO_REF_*` ID + `restaurantSlugs`.
6. **`execute_sql`** (MCP): DuckDB spatial queries for structured filters (cuisine, price, awards).

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
- `get_isoline` returns `GEO_REF_ABC123` instead of full polygon
- SQL queries reference `ST_GeomFromGeoJSON(GEO_REF_ABC123)`
- **IDs are request-scoped** — expire after each response, must re-call `get_isoline` for follow-ups

### Filter Pool Scoping

Frontend filter selections are passed as `filterPool` in request context:
- `execute_sql` injects `WHERE slug IN (...)` clause
- `semantic_search_restaurants` accepts `scopeToSlugs` from prior isochrone
- `filterPoolSlugs` is computed in MapContext.tsx from active filter state

## Fuzzy Restaurant Matching

`fuzzyMatchRestaurant()` in chat.ts uses 5-tier matching:
1. Exact slug match
2. Normalized name match (removes articles, "and", special chars)
3. Partial name match (substring)
4. Slug similarity match
5. Levenshtein distance (typo tolerance, threshold 2-3)

## Map Marker Colors

Priority system (higher overrides lower):
1. **Orange (#FF9100)** — Selected restaurant
2. **Pink (#ff67b2)** — Favorites
3. **Red (#c81224)** — Award winners (Michelin/NYT)
4. **Grey (#928f8e)** — Default

## Environment Variables

```
# Backend (api/)
GOOGLE_API_KEY                  # Google Gemini API key
GOOGLE_GENERATIVE_AI_API_KEY    # Alternative Gemini key
MCP_SERVER_URL                  # MCP server endpoint (marauders-query-mcp)
MCP_API_KEY                     # MCP authentication
MCP_ANALYSIS_ID                 # Dataset ID in MCP
PINECONE_API_KEY                # Pinecone vector DB
PINECONE_INDEX_NAME             # Pinecone index name
API2_PORT                       # API server port (default 3001)

# Frontend (Vite, prefixed with VITE_)
VITE_MAPBOX_TOKEN               # Mapbox GL JS map rendering
```

## Development Workflow

1. **Frontend only**: `npm run dev` (port 5173) — works with production API
2. **Full stack local**:
   - Terminal 1: Start MCP server (marauders-query-mcp)
   - Terminal 2: `npm run api:dev` (port 3001)
   - Terminal 3: `npm run dev` (port 5173)
   - Vite proxies `/chat` requests to port 3001 (configured in vite.config.ts)
3. **With Vercel**: `npm run vercel-dev` (port 3000)

**Hot reload**: Vite hot-reloads frontend. Backend uses tsx watch for auto-restart.

## Debugging Tips

- **Tool not being called?** Check system prompt in `api/chat.ts` — query patterns table determines tool selection
- **Isochrone not scoping?** Ensure `scopeToSlugs` is passed from `get_isoline` to `semantic_search_restaurants`. Check console for `🗺️ Scoping semantic search to X restaurants from isochrone`
- **Restaurants not displaying?** `displayRestaurants` MUST be called after any search tool. Check `restaurant_names` array is being passed correctly.
- **Outside Manhattan errors?** `geocode` and `get_isoline` validate against Manhattan bounds (postcodes 100xx–102xx)
- **Rate limits?** Gemini has RPM limits; monitor console for 429 errors

## Known Limitations

- **Manhattan only** — no other boroughs
- **Static data** — FinalData.json is manually curated (628 restaurants)
- **GEO_REF expiration** — IDs expire per request; follow-up queries need fresh isochrones
- **No test suite** — ad-hoc test scripts in `scripts/` (test-endpoint.js, test-fuzzy-matching.js) but no Jest/Vitest configuration
