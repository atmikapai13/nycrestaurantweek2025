# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NYC Eats is a conversational geospatial restaurant discovery tool for Manhattan. "Remi" (Ratatouille persona) answers chat queries and renders results on a map.
- **Frontend**: React 19 + TypeScript + Vite + Mapbox GL, Tailwind v4 + shadcn/ui
- **Backend**: Hono on Vercel Functions, AI SDK UI-message streaming
- **AI**: Google Gemini 2.5 Flash: one structured-output call to parse the request, one streamed call to narrate. Retrieval is plain code.
- **Geo**: Mapbox Search Box + Geoapify geocoding (validated, Manhattan-preferring); Geoapify isochrones (walk / bike / drive / transit), hedged against occasional stalls
- **Search**: in-memory cosine search over `src/data/embeddings.json` (`gemini-embedding-001`, 768-d), hybrid 70% semantic / 30% keyword
- **Data**: 644 restaurants in `src/data/FinalData.json` (Yelp, Reddit sentiment, Michelin/NYT awards, Restaurant Week meal types, coordinates)

## Commands

```bash
npm run dev                   # Vite frontend (5173), served under /winter2026/
npm run api:dev               # Local Hono API server with tsx watch (3001) — REQUIRED for chat in dev
npm run vercel-dev            # Vercel Functions locally (3000)
npm run build                 # tsc + vite build → dist/winter2026
npm run lint                  # ESLint, --max-warnings 0
npm run embeddings:generate   # Regenerate src/data/embeddings.json from FinalData.json (needed after data changes)
node scripts/benchmark-chat.js --label <name>   # Speed + consistency benchmark (needs api:dev); report → benchmarks/results/
```

There is no unit test suite; `scripts/benchmark-chat.js` is the end-to-end check (8 prompts × N runs, reports speed and whether results are identical across runs). `node scripts/validate-restaurant-data.js` checks `FinalData.json` for missing fields. `npm run lint` currently fails to start: `eslint.config.js` imports `typescript-eslint`, which isn't installed.

## Development Setup

In dev, `src/config/features.ts` hard-codes the chat/transcribe endpoints to `http://localhost:3001`, so `npm run dev` alone gives a working map but a broken chat — run `npm run api:dev` alongside it.

## Deployment (subpath build)

This branch (`winter2026`) is built as a self-contained subpath app:
- `vite.config.ts` sets `base: "/winter2026/"` and `outDir: "dist/winter2026"`. The site is served at `nyceats.live/winter2026/` via a separate Vercel router project, and also on its own `.vercel.app` domain.
- **Public assets must go through `asset()`** (`src/utils/asset.ts`), e.g. `asset("/characters/anton.png")`. Hard-coded `/foo.png` paths break under the subpath.
- `vercel.json` rewrites `/winter2026/api/*` → `/api/*`; functions have a 60s max duration (`includeFiles` bundles `FinalData.json` and `embeddings.json` with the functions). Every `.ts` file under `api/` becomes a function and the Hobby plan allows 12 per deployment, so only real endpoints (`chat.ts`, `transcribe.ts`) live there by name; helpers and the dev server are `_`-prefixed (`_lib/`, `_schemas/`, `_env.ts`, `_server.ts`), which Vercel skips. Vercel deploys from this branch; the `gh-pages` branch is excluded. `npm run deploy` (gh-pages) is legacy.
- Kill switch: set `CHATBOT_DOWN = true` in `src/components/ChatInterface.tsx` to take Remi offline (shows a down message instead of calling the API).

## Request Flow (`api/chat.ts`)

Three steps; see `api/README.md` for detail.

1. **Parse** — `_lib/intent.ts`: one Gemini call with a Zod schema (temperature 0, fixed seed, thinking off) → `SearchIntent` (kind, locations, travel mode/minutes, vibes, cuisines from the dataset's own list, prices, awards, Restaurant Week). The previous turn's intent is passed in so "cheaper" / "show me more" refine it.
2. **Search** — `_lib/searchPipeline.ts`, no LLM: geocode (`_lib/geo.ts`: known-places table → Mapbox Search Box → Geoapify; a hit is only accepted if it validates — name match / confidence — and ambiguous names prefer the Manhattan reading; otherwise Remi asks) → isochrones in parallel → intersect for multiple people (if mode/minutes are missing, `travelPlan` starts at a 15-min walk for one place or 20-min transit for several, and widens only until something matches; stated values are never changed) → `filterPool`/cuisine/price/award/RW filters → rank by `_lib/vectorSearch.ts` if vibes were given, else a fixed quality score (ties broken by slug) → top 5.
3. **Narrate** — `_lib/narrate.ts`: one short streamed call that only describes the chosen restaurants; clarifications and out-of-Manhattan replies are canned.

Same prompt ⇒ same intent ⇒ same restaurants. Intents, geocodes, isochrones and query embeddings are cached per warm instance; the header `x-nyceats-cache: off` bypasses that.

`MapContext.tsx` computes `filterPoolSlugs` from the filter bar; `ChatInterface.tsx`'s custom transport sends it plus browser `userLocation` as `context` on every request.

## Frontend ↔ Backend Contract

The backend streams parts shaped like the old MCP tool calls, and `ChatInterface.tsx` drives the map from them by **tool name and output shape**: `geocode` (dynamic) → `structuredContent.results[0]` (character markers), `get_isoline` (dynamic) → `structuredContent.results[0].geojson` (layers; overlap computed client-side once all isoline parts finish), `tool-semantic_search_restaurants` → `restaurantWeekDetected`, `tool-displayRestaurants` → card payload (rendered only after the stream ends). A `data-intent` part rides along in history for follow-ups. Change both sides together.

## Design Tokens

All colors and fonts come from `src/styles/tokens.ts` (documented in `DESIGN.md`): `var(--color-*)` / `var(--font-*)` in CSS, Tailwind classes like `bg-pink-soft` / `text-grey-dark`, `colors.*` in TS. Don't hard-code hex values. UI primitives are shadcn/ui in `src/components/ui/` (Tailwind v4 without preflight; `tokens.css` is generated from `tokens.ts` by `vite.config.ts`).

## Map Markers

Markers are Mapbox layers, not DOM elements (`src/components/restaurantLayers.ts`; images drawn once on a canvas): grey dots (`colors.grey`), pink (`colors.pinkLight`) for favorites, sized by zoom; Remi's current picks (`recommendedSlugs` in MapContext, set from `displayRestaurants` results) are plain red teardrops, a bit smaller than the selected one; the selected restaurant is a cuisine-emoji teardrop (`CUISINE_EMOJI` in `Map.tsx`) with a Yelp-star arc. Searched places render as character portraits (`public/characters/1_alfredo.png`…, assigned in order per search) in a layer above the markers; isochrones are inserted beneath everything. The user's own location is a pulsing blue DOM dot.

## Environment Variables

Backend (`api/_env.ts`; loads `.env.local`, then `.env`): `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`, `GEOAPIFY_API_KEY`, `API2_PORT` (default 3001). Frontend: `VITE_MAPBOX_TOKEN`. The `.env*` files contain real secrets — stage files explicitly rather than `git add -A`.

## Debugging

- Each request logs `🧭 "<message>" → <kind>: <search description>` (the parsed intent) and a `⏱️ Request …` block with per-LLM-call and per-API timings, tokens, and the restaurants shown.
- Wrong results: check the parsed intent first. If it's right, the bug is in `searchPipeline.ts` and is reproducible; if it's wrong, adjust the field descriptions in `buildIntentSchema`.
- Gemini 429s during intent parsing return HTTP 429 `RATE_LIMIT`; later in the stream they arrive as an error chunk containing `RATE_LIMIT`.
