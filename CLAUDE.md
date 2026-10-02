# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NYC Eats is a conversational geospatial restaurant discovery tool for Manhattan. "Remi" (Ratatouille persona) answers chat queries by calling geo + search tools and rendering results on a map.
- **Frontend**: React 18 + TypeScript + Vite + Mapbox GL
- **Backend**: Hono on Vercel Functions, AI SDK (`streamText`) + MCP client (marauders-query-mcp) for geocode / isochrone / DuckDB SQL
- **AI**: Google Gemini 2.5 Flash, multi-step tool calling (`stopWhen: stepCountIs(10)`)
- **Search**: Pinecone + `gemini-embedding-001`, hybrid 70% semantic / 30% keyword scoring
- **Data**: 644 restaurants in `src/data/FinalData.json` (Yelp, Reddit sentiment, Michelin/NYT awards, Restaurant Week meal types, coordinates)

## Commands

```bash
npm run dev                   # Vite frontend (5173), served under /spring2026/
npm run api:dev               # Local Hono API server with tsx watch (3001) — REQUIRED for chat in dev
npm run vercel-dev            # Vercel Functions locally (3000)
npm run build                 # tsc + vite build → dist/spring2026
npm run lint                  # ESLint, --max-warnings 0
npm run embeddings:setup      # Regenerate + upload Pinecone embeddings from FinalData.json
node scripts/benchmark-chat.js --label <name>   # Speed + consistency benchmark (needs api:dev); report → benchmarks/results/
```

There is no test suite or chat-endpoint test harness. `scripts/` holds only the Pinecone embedding scripts (run them whenever `FinalData.json` changes) and `node scripts/validate-restaurant-data.js`, which checks `FinalData.json` for missing fields.

## Development Setup

In dev, `src/config/features.ts` hard-codes the chat/transcribe endpoints to `http://localhost:3001`, so `npm run dev` alone gives a working map but a broken chat — run `npm run api:dev` alongside it. The MCP server is remote (`MCP_SERVER_URL`); it does not need to run locally.

## Deployment (subpath build)

This branch (`spring2026`) is built as a self-contained subpath app:
- `vite.config.ts` sets `base: "/spring2026/"` and `outDir: "dist/spring2026"`. The site is served at `nyceats.live/spring2026/` via a separate Vercel router project, and also on its own `.vercel.app` domain.
- **Public assets must go through `asset()`** (`src/utils/asset.ts`), e.g. `asset("/characters/anton.png")`. Hard-coded `/foo.png` paths break under the subpath.
- `vercel.json` rewrites `/spring2026/api/*` → `/api/*`; functions have a 60s max duration (the chat stream aborts at 55s). Vercel deploys from this branch; the `gh-pages` branch is excluded. `npm run deploy` (gh-pages) is legacy.
- Kill switch: set `CHATBOT_DOWN = true` in `src/components/ChatInterface.tsx` to take Remi offline (shows a down message instead of calling the API).

## Request Flow (`api/chat.ts`)

`api/chat.ts` holds the whole backend: Hono handler, system prompt, tool definitions, MCP wrappers, fuzzy matching. Per request:

1. **Name-lookup short-circuit** (top of `chatHandler`): a regex extracts a possible restaurant name from the last user message and runs `fuzzyMatchRestaurant()`. If it matches (and isn't a generic term like "italian" or "cozy"), the handler streams a hand-built `displayRestaurants` response **without calling Gemini**.
2. **MCP context** from `getMcpContext()`: the MCP connection, tool list, spatial-function reference docs, and dataset schemas are cached at module scope per warm instance (failures are not cached). Schemas and spatial docs are injected into the system prompt.
3. **Tool wrapping**: MCP tools are wrapped with request-scoped logic (see below), combined with local tools, and passed to `streamText`.
4. Response streams via `toUIMessageStreamResponse()`; the frontend renders tool parts progressively.

### Tools actually registered (`allTools`)

- `geocode` (MCP) — wrapper validates Manhattan via bounds, postcode, and borough names; a `MANHATTAN_NEIGHBORHOODS` table overrides the MCP geocoder, which tends to return Central Park for neighborhood queries.
- `get_isoline` (MCP) — wrapper does point-in-polygon (Turf) against all restaurants, returns `restaurantSlugs` + summaries, and pushes the slugs to the request-scoped `allIsochroneSlugs`.
- `execute_sql` (MCP, DuckDB) — wrapper rewrites `cuisine = 'X'` / `cuisine IN (...)` to `ILIKE '%X%'` and injects the `filterPool` constraint. The table name is the quoted `MCP_ANALYSIS_ID`.
- `semantic_search_restaurants` (local, `api/lib/ragSearchLogic.ts`) — scope priority: `scopeToSlugs` arg > intersection of `allIsochroneSlugs` > `filterPool` > all. Restaurant Week intent narrows to restaurants with `meal_types`.
- `displayRestaurants` (local) — resolves names/slugs (exact, then fuzzy) within `filterPool`, preserves input order, caps at 5 cards. Users see nothing unless this is called.

`lookupRestaurantTool` and the `search_documents` wrapper are defined but **not registered**.

### Isochrone scoping & midpoints

Every `get_isoline` call in a request appends to `allIsochroneSlugs`. The next `execute_sql`/`semantic_search_restaurants` is automatically restricted to the **intersection** of all of them, which is how "between A and B" queries work — the model should not write `ST_Intersection` SQL. This state is request-scoped; follow-up turns must re-call `get_isoline`.

### GEO_REF pattern

`api/utils/toolWrapper.ts` + `geometryOptimizer.ts` simplify isochrone polygons and replace them with short `GEO_REF_*` IDs in what the model sees (SQL can reference `ST_GeomFromGeoJSON(GEO_REF_X)`). IDs expire after each response.

### Filter pool

`MapContext.tsx` computes `filterPoolSlugs` from the filter bar; `ChatInterface.tsx`'s custom transport injects it (plus `userLocation` from browser geolocation) into `context` on every request. Backend tools scope to it as described above.

## Frontend ↔ Backend Contract

`ChatInterface.tsx` drives the map by matching **tool names and output shapes** from the stream: `geocode` → `results[0].latitude/longitude` (character markers), `get_isoline` → `geojson` (isochrone layers; waits for all isoline parts in a message before intersecting), `execute_sql` → `rows`, `displayRestaurants` → card payload. Renaming a tool or changing its output shape on the backend silently breaks map rendering — update both sides together.

## Map Markers

Restaurant dot colors by priority: selected orange `#FF9100` > favorite pink `#ff67b2` > award red `#c81224` > default grey `#928f8e`. At zoom ≥15 (14.5 mobile) dots become cuisine-emoji teardrops (`CUISINE_EMOJI` in `Map.tsx`). Geocoded locations render as character portraits in pink-rimmed circles (`.isochrone-character-marker`); the user's own location is a pulsing blue dot.

## Environment Variables

Backend (`api/env.ts`, T3 Env): `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`, `MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_ANALYSIS_ID`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `API2_PORT` (default 3001). Frontend: `VITE_MAPBOX_TOKEN`. The `.env*` files contain real secrets — stage files explicitly rather than `git add -A`.

## Debugging

- Wrong or missing tool calls: check the system prompt's query-pattern table in `api/chat.ts`; `onStepFinish` logs each step's tools, args, and result sizes.
- Isochrone not scoping: look for `🗺️ Scoping semantic search…` / `Auto-injecting … isochrone slugs` in the API logs.
- Gemini 429s are caught and returned as a `RATE_LIMIT` error with a Remi-voiced message.
