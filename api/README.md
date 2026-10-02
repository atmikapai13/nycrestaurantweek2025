# Chat API

`POST /chat` powers Remi. It used to be a Gemini agent loop that called geocode,
isochrone, SQL, and search tools one step at a time; it's now a fixed three-step
pipeline where the LLM only handles language:

1. **Parse** (`lib/intent.ts`): one Gemini 2.5 Flash call with structured output
   (temperature 0, fixed seed, thinking off) turns the message into a
   `SearchIntent`: locations, travel mode/minutes, vibes, cuisines, prices,
   awards, Restaurant Week, and kind (search / lookup / area summary / more / chitchat).
   The previous intent is passed in so follow-ups like "cheaper" refine it.
2. **Search** (`lib/searchPipeline.ts`): plain code, no LLM. Geocode and isochrones
   via Geoapify in parallel (`lib/geo.ts`), intersection for multiple people,
   in-memory filters, then ranking: semantic (`lib/vectorSearch.ts`, local
   embeddings) when vibes are given, otherwise a fixed quality score. Top 5.
3. **Narrate** (`lib/narrate.ts`): one short streamed Gemini call describes the
   restaurants already chosen. Clarifications and out-of-Manhattan replies are
   canned text with no LLM call.

Same prompt → same intent → same restaurants. Intents, geocodes, isochrones and
query embeddings are also cached per warm instance.

## Stream contract

The route streams AI SDK UI-message chunks shaped like the old tool calls, so the
frontend renders them unchanged:

| Part | Frontend use |
|---|---|
| `geocode` (dynamic tool) → `structuredContent.results[0]` | character marker |
| `get_isoline` (dynamic tool) → `structuredContent.results[0].geojson` | isochrone layer (and overlap) |
| `tool-semantic_search_restaurants` → `restaurantWeekDetected` | turns on the Restaurant Week filter |
| `tool-displayRestaurants` → `restaurants` | restaurant cards |
| `data-intent` | returned in history so the next turn can refine the search |

## Files

- `chat.ts`: Hono route, stream assembly
- `lib/requestMetrics.ts`: per-request timing/token log; sent as message metadata when the `x-nyceats-metrics: 1` header is present
- `lib/restaurants.ts`: dataset, fuzzy name matching, card payload
- `server.ts`: local dev server (`npm run api:dev`, port 3001)
- `transcribe.ts`: voice input

## Environment

`GOOGLE_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) and `GEOAPIFY_API_KEY`.
`env.ts` loads `.env.local`, then `.env`.

## Measuring

`node scripts/benchmark-chat.js --label <name>` replays a fixed prompt set and
writes a speed + consistency report to `benchmarks/results/`. The header
`x-nyceats-cache: off` (the benchmark default) bypasses the server caches.
