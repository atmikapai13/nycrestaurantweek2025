# NYC Eats

NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.

---

## Architecture Overview

### Current Architecture (AI SDK + MCP)

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  - ChatInterface.tsx (AI SDK useChat hook)                  │
│  - Map.tsx (Mapbox GL JS + Turf.js)                         │
│  - MapContext (Isochrone layer management)                  │
└─────────────────┬───────────────────────────────────────────┘
                  │ POST /chat (streaming)
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                    api2/ (Hono + AI SDK)                     │
│  - chat.ts: Streaming endpoint using AI SDK                 │
│  - Uses Google Gemini 2.5 Flash                             │
│  - T3 Env for environment variable management               │
│  - Geometry optimization middleware                          │
└─────────────────┬───────────────────────────────────────────┘
                  │ MCP Protocol
                  ↓
┌─────────────────────────────────────────────────────────────┐
│           MCP Server (marauders-query-mcp)                   │
│  - execute_sql: DuckDB spatial queries                      │
│  - search_documents: Vector search for restaurant reviews   │
│  - geocode: Address → lat/lng                               │
│  - get_isoline/get_isochrone: Travel-time polygons          │
│  - Geometry caching & optimization                           │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

**Frontend:**

- **React 18** with TypeScript
- **Vite** for build tooling
- **Mapbox GL JS** for interactive maps
- **Turf.js** for client-side geospatial operations
- **AI SDK** (`@ai-sdk/react`) for chat streaming
- **MapContext** for centralized isochrone layer management

**Backend (`api2/`):**

- **Hono** web framework
- **AI SDK** (`ai` package) for streaming responses
- **Google Gemini 2.5 Flash** as the LLM
- **MCP Client** for tool access
- **T3 Env** for type-safe environment variables
- **Zod** for request validation
- **Geometry Optimizer** for reducing polygon complexity

**MCP Server (External):**

- **DuckDB** for spatial SQL queries
- **Pinecone** for vector search (restaurant reviews)
- **Geoapify** for geocoding and isochrones
- Python-based FastAPI server

---

## Tech Stack

### Frontend

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Mapbox GL JS** - Interactive maps
- **Turf.js** - Geospatial calculations (free, client-side)
- **AI SDK** - Streaming chat interface
- **CSS3** - Styling with glass morphism effects

### Backend (api2/)

- **Node.js** - Runtime (ESM modules)
- **Hono** - Web framework
- **AI SDK** - Streaming and tool orchestration
- **Google Gemini 2.5 Flash** - LLM with function calling
- **MCP (Model Context Protocol)** - Tool access protocol
- **T3 Env** - Type-safe environment variables
- **Zod** - Schema validation
- **tsx** - TypeScript execution

### Data

- **Static JSON** - 628 restaurants with Yelp reviews, Reddit sentiment, Michelin/NYT awards
- **Vector Embeddings** - Pre-computed semantic embeddings for RAG search (via MCP)
- **GeoJSON** - Restaurant locations and isochrone polygons

---

## Local Development

### Prerequisites

1. **Node.js** v18+ (v20 recommended)
2. **npm** or **pnpm**
3. **MCP Server** running (see `marauders-query-mcp` repository)
4. **Environment Variables** (see below)

### Environment Setup

Create a `.env.local` file in the project root:

```bash
# Google Gemini API (required)
GOOGLE_API_KEY=your_google_api_key_here

# MCP Server (required)
MCP_SERVER_URL=http://localhost:8000/mcp
MCP_API_KEY=your_mcp_api_key
MCP_ANALYSIS_ID=your_analysis_id

# API Server (optional)
API2_PORT=3001
NODE_ENV=development

# Mapbox (required for frontend)
VITE_MAPBOX_TOKEN=your_mapbox_token
```

### Installation

```bash
# Install dependencies
npm install

# Start MCP server (in separate terminal)
cd ../marauders-query-mcp
make dev

# Start api2 backend (in separate terminal)
npm run api2:dev
# Server will run on http://localhost:3001

# Start frontend dev server
npm run dev
# Frontend will run on http://localhost:5173
```

### Development Commands

```bash
# Frontend Development
npm run dev                    # Start Vite dev server (port 5173)
npm run build                  # Build for production
npm run preview                # Preview production build

# Backend Development (api2/)
npm run api2:dev              # Start backend with hot reload (port 3001)

# Type Checking
npm run type-check            # Check TypeScript types across project

# Linting
npm run lint                  # Run ESLint
```

---

## How It Works

### Chat Flow

1. **User sends message** via `ChatInterface.tsx`
2. **Frontend calls** `POST http://localhost:3001/chat` with message history
3. **Backend validates** request with Zod schemas
4. **AI SDK streams** response using Google Gemini
5. **Gemini calls tools** via MCP protocol when needed
6. **Tools return results** (SQL queries, vector search, geocoding, isochrones)
7. **Frontend processes** tool results and updates map/UI

### Example Queries

The system can handle complex multi-step queries:

```
"Find Japanese restaurants with $$"
→ Filters restaurants by cuisine and price level

"Show me Michelin-starred date night spots"
→ Filters by awards, then searches for romantic ambiance

"Italian restaurants in Williamsburg with great pasta"
→ Filters by cuisine and neighborhood, then searches reviews for pasta mentions

"Restaurants within 15 minutes walking from Grand Central"
→ Geocodes location, generates walking isochrone, finds restaurants inside

"I'm at the Vessel, my friend's in LIC. What's good between us?"
→ Geocodes both locations, generates two isochrones, finds intersection, returns restaurants

"Show me cozy spots with outdoor seating near Union Square"
→ Geocodes Union Square, creates isochrone, searches for cozy + outdoor seating

"Korean BBQ places with 4+ stars in Manhattan"
→ Filters by cuisine, rating, and borough

"Find me a hole-in-the-wall with amazing reviews"
→ Semantic search for "hole-in-the-wall" combined with high ratings
```

### Tool Execution Example

```
User: "Find Italian restaurants within 15 minutes of Greenwich Village"

1. geocode("Greenwich Village, New York City")
   → { latitude: 40.7336, longitude: -73.9975 }

2. get_isoline(lat, lng, travel_time=15, mode="transit")
   → { geojson: <polygon>, simplified_id: "GEO_REF_ABC123" }

3. execute_sql(`
     SELECT name, cuisine, rating FROM restaurants
     WHERE cuisine = 'Italian'
     AND ST_Intersects(geometry, ST_GeomFromGeoJSON(GEO_REF_ABC123))
   `)
   → { rows: [...restaurant data...] }

4. displayRestaurants([restaurant_names])
   → Shows restaurant cards in chat

Frontend processes tool results:
- Adds isochrone layer to map
- Highlights restaurants within polygon
- Displays restaurant cards
```

### Geometry Optimization

To reduce token usage, the system optimizes GeoJSON geometries:

1. **Simplification**: Reduces polygon complexity using Douglas-Peucker algorithm
2. **Caching**: Stores simplified geometries with placeholder IDs (e.g., `GEO_REF_ABC123`)
3. **SQL Substitution**: Automatically replaces IDs in SQL queries with actual geometry

This reduces a 50KB polygon to a 10-character ID in prompts.

---

## Deployment

### Vercel Deployment (Recommended)

The project is configured for Vercel with:

- Frontend: Static site
- Backend: Serverless functions in `api2/`

#### Prerequisites

1. Vercel account
2. Environment variables configured in Vercel dashboard
3. MCP server deployed and accessible

#### Deploy Steps

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy (first time)
vercel

# Deploy to production
vercel --prod
```

#### Vercel Configuration

The `vercel.json` is configured to:

- Serve frontend as static files
- Route `/chat` to `api2/chat.ts`
- Set proper headers for CORS
- Configure build settings

#### Environment Variables in Vercel

Add these in the Vercel Dashboard (Settings → Environment Variables):

```
GOOGLE_API_KEY=...
MCP_SERVER_URL=https://your-mcp-server.com/mcp
MCP_API_KEY=...
MCP_ANALYSIS_ID=...
VITE_MAPBOX_TOKEN=...
```

### GitHub Pages (Static Only)

For frontend-only deployment (requires separate backend):

```bash
# Build and deploy to gh-pages branch
npm run deploy
```

**Note**: This only deploys the frontend. You'll need to:

1. Deploy `api2/` separately (e.g., Railway, Fly.io)
2. Update `src/config/features.ts` with your backend URL

---

## Project Structure

```
nycrestaurantweek2025/
├── src/                          # Frontend source
│   ├── components/               # React components
│   │   ├── ChatInterface.tsx    # Main chat UI with AI SDK
│   │   ├── Map.tsx              # Mapbox map component
│   │   ├── MapLegend.tsx        # Map controls
│   │   └── RestaurantCard.tsx   # Restaurant display
│   ├── contexts/
│   │   └── MapContext.tsx       # Isochrone layer management
│   ├── types/
│   │   ├── ai-message.ts        # AI SDK message types
│   │   ├── restaurant.ts        # Restaurant data types
│   │   └── chat.ts              # Chat types
│   ├── utils/
│   │   └── geospatial.ts        # Turf.js utilities
│   ├── services/
│   │   └── chatService.ts       # Legacy chat service
│   ├── config/
│   │   └── features.ts          # API endpoints config
│   └── data/
│       └── FinalData.json       # Restaurant dataset
│
├── api2/                         # Backend (Hono + AI SDK)
│   ├── chat.ts                  # Main streaming endpoint
│   ├── server.ts                # Local dev server
│   ├── env.ts                   # T3 Env configuration
│   ├── schemas/
│   │   └── chat.ts              # Zod validation schemas
│   └── utils/
│       ├── geometryOptimizer.ts # Polygon simplification
│       └── toolWrapper.ts       # Tool middleware
│
├── api/                          # Legacy backend (deprecated)
├── public/                       # Static assets
├── scripts/                      # Data processing scripts
├── vercel.json                   # Vercel deployment config
├── vite.config.ts               # Vite build config
└── package.json                 # Dependencies
```

---

## Key Features

### 🗺️ Geospatial Intelligence

- **Isochrones**: Generate travel-time polygons (walking, transit, driving, cycling)
- **Multi-party intersections**: "Find restaurants between us"
- **Spatial SQL**: DuckDB-powered geospatial queries
- **Client-side operations**: Polygon intersection, union, exclusion with Turf.js

### 💬 Conversational AI

- **Streaming responses**: Real-time chat with AI SDK
- **Multi-tool orchestration**: Chain multiple tools in single request
- **Context awareness**: Remembers visible restaurants, active filters
- **Natural language**: "Show me cozy Italian spots within 15 min of Times Square"

### 🎨 User Experience

- **Interactive map**: Mapbox GL JS with custom styling
- **Restaurant cards**: Rich information with Yelp reviews, awards
- **Filter modes**: Awards, favorites, highlighted results
- **Mobile responsive**: Drawer interface for mobile devices
- **Real-time updates**: Map layers update as chat progresses

### 🔍 Smart Search

- **Semantic search**: Vector-based search for vibes/ambiance
- **SQL queries**: Precise filtering by cuisine, price, rating
- **Fuzzy matching**: Handles typos and partial names
- **Scoped search**: Filter within visible isochrone region

---

## Environment Variables Reference

### Backend (api2/)

| Variable          | Description           | Required | Example                     |
| ----------------- | --------------------- | -------- | --------------------------- |
| `GOOGLE_API_KEY`  | Google Gemini API key | Yes      | `AIza...`                   |
| `MCP_SERVER_URL`  | MCP server endpoint   | Yes      | `http://localhost:8000/mcp` |
| `MCP_API_KEY`     | MCP authentication    | Yes      | `sk_...`                    |
| `MCP_ANALYSIS_ID` | Dataset ID in MCP     | Yes      | `cmk7...`                   |
| `API2_PORT`       | Backend port          | No       | `3001` (default)            |
| `NODE_ENV`        | Environment           | No       | `development`               |

### Frontend

| Variable            | Description        | Required | Example      |
| ------------------- | ------------------ | -------- | ------------ |
| `VITE_MAPBOX_TOKEN` | Mapbox GL JS token | Yes      | `pk.eyJ1...` |

---

## Troubleshooting

### Common Issues

**1. "Cannot find module '@ai-sdk/react'"**

```bash
npm install @ai-sdk/react ai
```

**2. "Invalid environment variables"**

- Check `.env.local` exists in project root
- Verify all required variables are set
- Check for typos in variable names

**3. "MCP connection failed"**

- Ensure MCP server is running
- Check `MCP_SERVER_URL` points to correct endpoint
- Verify `MCP_API_KEY` is valid

**4. Map not loading**

- Check `VITE_MAPBOX_TOKEN` is set
- Verify Mapbox token is valid
- Check browser console for errors

**5. GEO_REF IDs not working across messages**

- This is expected! GEO_REF IDs are request-scoped
- The assistant must re-call `get_isoline` for each new request
- See system prompt for examples

---

## Future Enhancements

### Planned Features

- [ ] **Real-time reservation availability** - Integration with OpenTable/Resy APIs
- [ ] **User reviews and ratings** - Allow users to contribute their own reviews
- [ ] **Dish photo gallery** - Visual menu with photos from Instagram/Google
- [ ] **Restaurant comparison tool** - Side-by-side comparison of multiple restaurants
- [x] **Transit-time-based isochrone calculations** - Already implemented via MCP
- [ ] **Push notifications for favorite restaurants** - Alert users about special events
- [ ] **Multi-borough expansion** - Extend beyond Manhattan to Brooklyn, Queens, etc.
- [ ] **Voice interface** - Speech-to-text for hands-free queries
- [ ] **Collaborative planning** - Share searches and favorites with friends
- [ ] **Dietary restrictions filtering** - Vegan, gluten-free, halal, kosher options
- [ ] **Price alerts** - Notify when restaurants run specials or change price tiers
- [ ] **Menu integration** - Deep link to full menus and pricing

### Advanced Features (Research)

**Multi-Agent Patterns:**

- Research agent for deep dive into restaurant history/reviews
- Recommendation agent specialized in personalization
- Coordination agent for group dining scenarios

**Enhanced Geospatial:**

- Cross-borough isochrone queries
- Multi-modal transit routing (subway + walking)
- Real-time traffic/transit delays integration
- Neighborhood boundary awareness

**Data Enrichment:**

- Real-time hours/status from Google Places
- Live wait times and reservation availability
- Menu integration with pricing
- Michelin Guide / James Beard Awards updates
- Health inspection scores

**Performance & Observability:**

- LangSmith integration for debugging chains
- Memory summarization for long conversations
- Parallel tool execution optimization
- Response caching strategies

**Voice & Multimodal:**

- Web Speech API for MVP
- OpenAI Whisper for production
- Real-time transcription
- Voice commands and responses

---

## Contributing

This is a research project exploring conversational geospatial interfaces. Key areas for contribution:

1. **Data quality**: Improve restaurant metadata, reviews, ratings
2. **Tool design**: Better geospatial primitives and search patterns
3. **UX patterns**: How should users interact with map agents?
4. **Performance**: Optimize geometry handling, caching strategies

---

## Credits

- Built by **Atmika Pai** in collaboration with **Fulton Ring** and **Marauders.Earth**
- Powered by Google Gemini, Mapbox, and the Model Context Protocol (MCP)
- Restaurant data from Yelp, Reddit, Michelin Guide, and NYT

---

## License

MIT License - See LICENSE file for details

---

## Related Projects

- **marauders-query-mcp**: Python-based MCP server with DuckDB and Pinecone
- **Marauders.Earth**: Geospatial analytics platform
- **Fulton Ring**: Infrastructure and tooling for location-aware AI
