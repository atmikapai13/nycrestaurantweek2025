# NYC Eats

NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.

---

## Features

- 🗺️ Interactive Mapbox map showing 628+ participating restaurants
- 🤖 AI chatbot (Remi) powered by Google Gemini for natural language restaurant search
- 🔍 Multi-criteria filtering (cuisine, price, vibes, ratings, awards)
- ⭐ Michelin stars, Bib Gourmand, and NYT Top 100 restaurant highlights
- 📝 Yelp review highlights and Reddit community opinions
- ❤️ Favorites system with shareable URLs
- 📱 Responsive design for mobile and desktop

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

## Project Structure

```
nycrestaurantweek2025/
├── src/
│   ├── components/              # React UI components
│   │   ├── App.tsx              # Main app, filter orchestration
│   │   ├── ChatInterface.tsx    # AI chatbot UI and tool execution
│   │   ├── Map.tsx              # Mapbox integration
│   │   ├── Filters.tsx          # Filter controls
│   │   ├── RestaurantCard.tsx   # Detail view
│   │   ├── Header.tsx           # App header
│   │   └── ErrorBoundary.tsx    # Error handling
│   │
│   ├── data/
│   │   └── FinalData.json       # 628 restaurants with reviews, coords, awards
│   │
│   ├── services/
│   │   └── chatService.ts       # API client for /api/chat endpoint
│   │
│   ├── hooks/
│   │   └── useChatMap.ts        # Custom hook for chat-map integration
│   │
│   ├── utils/
│   │   ├── geospatial.ts        # Turf.js geographic utilities
│   │   └── safeStringOps.ts     # Null-safe string operations
│   │
│   ├── types/
│   │   └── restaurant.ts        # TypeScript interfaces
│   │
│   ├── config/
│   │   └── features.ts          # Feature flags (chat toggle, API URL)
│   │
│   ├── App.tsx                  # Root component
│   └── main.tsx                 # Entry point
│
├── api/
│   ├── chat.js                  # Gemini AI endpoint with 10 tool definitions
│   └── rag-search.js            # Pinecone vector search endpoint
│
├── scripts/
│   ├── generate-embeddings.js   # Generate vector embeddings for RAG
│   ├── upload-to-pinecone.js    # Upload embeddings to Pinecone
│   └── validate-restaurant-data.js # Data quality checks
│
├── public/
│   ├── remi.png                 # Chatbot avatar
│   └── user_bot.png             # User avatar
│
└── vercel.json                  # Vercel deployment config
```

## How the AI Chatbot Works

### Architecture: Function Calling Pattern

Remi uses **Gemini's Function Calling** feature - a structured way for AI to execute actions. The backend **never sends restaurant data** to Gemini. Instead, Gemini receives conversation history and returns **function calls** that the frontend executes locally.

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

## Available Tools (10 Total)

Gemini has access to 10 function tools it can call based on user queries. These tools are executed **client-side** by the frontend.

### 🔍 Search & Filter Tools (4)

#### 1. `filter_map`
**Purpose**: Multi-criteria restaurant filtering
**Parameters**:
- `cuisines`: Array of cuisine types (e.g., `["Japanese", "Italian"]`)
- `price_levels`: Array of price points (`["$", "$$", "$$$", "$$$$"]`)
- `neighborhoods`: Array of neighborhoods
- `expand_neighborhoods`: Boolean - include adjacent areas
- `vibes`: Array of collection tags (`["date-night", "romantic", "cozy"]`)
- `awards`: Array of awards (`["michelin", "bib_gourmand", "nyt_top_100"]`)
- `min_rating`: Minimum Yelp rating (0-5)

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

#### 2. `calculate_midpoint`
**Purpose**: Find restaurants at geographic midpoint between two locations
**Parameters**:
- `location1`: Neighborhood name (e.g., `"Williamsburg"`)
- `location2`: Neighborhood name (e.g., `"Kips Bay"`)
- `radiusMiles`: Search radius from midpoint (default: 1.0 mile)
- `cuisines`: Optional cuisine filters
- `price_levels`: Optional price filters

**Example**:
```javascript
calculate_midpoint({
  location1: "Williamsburg",
  location2: "Kips Bay",
  radiusMiles: 1.0
})
```

**How it works**:
- Calculates true geographic midpoint using Turf.js
- Finds restaurants within radius of midpoint
- Sorts by "balance score" (equal distance from both locations)

#### 3. `semantic_search`
**Purpose**: Unstructured keyword-based search in reviews
**Parameters**:
- `query`: Search query
- `keywords`: Array of keywords to search for
- `pre_filters`: Optional filters (cuisine, price, etc.)

**Example**:
```javascript
semantic_search({
  query: "great cocktails",
  keywords: ["cocktails", "drinks"],
  pre_filters: { neighborhoods: ["East Village"] }
})
```

#### 4. `rag_search`
**Purpose**: AI-powered semantic search using vector embeddings (Pinecone)
**Parameters**:
- `query`: Natural language query
- `pre_filters`: Optional filters
- `top_k`: Number of results (default: 20)

**Example**:
```javascript
rag_search({
  query: "cozy romantic atmosphere for a date",
  top_k: 10
})
```

---

### 📊 Context & Detail Tools (6)

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
// "Found 47 restaurants
//  Cuisines: Italian (18), Indian (12), Japanese (9)
//  Locations: Manhattan (35), Brooklyn (10), Queens (2)
//  Top neighborhoods: East Village, Williamsburg, West Village
//  Price distribution: $ (5), $$ (20), $$$ (18), $$$$ (4)
//  Average rating: 4.2⭐
//  Awards: 3 Michelin-starred
//  Top-rated: Lilia, Carbone, Via Carota"
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

## Example Queries

```
"Find Japanese restaurants with $$"
→ Filters: cuisines=["Japanese"], price_levels=["$$"]

"Show me Michelin-starred date night spots"
→ Filters: awards=["michelin"], vibes=["date-night", "romantic"]

"Italian restaurants in Williamsburg with great pasta"
→ Filters: cuisines=["Italian"], neighborhoods=["Williamsburg"],
          semantic_features=["pasta"]

"Affordable seafood with outdoor seating"
→ Filters: cuisines=["Seafood"], price_levels=["$", "$$"],
          semantic_features=["outdoor"]
```

## Data Schema

Each restaurant object contains:
```typescript
{
  name: string
  slug: string
  cuisine: string
  price: "$" | "$$" | "$$$" | "$$$$"
  neighborhood: string
  latitude: number
  longitude: number
  yelp_rating: number
  yelp_review_highlights: string  // AI-generated summary of reviews
  reddit: string                   // Community sentiment
  michelin_award?: "ONE_STAR" | "TWO_STARS" | "THREE_STARS" | "BIB_GOURMAND"
  nyttop100_rank?: number
  collections: string[]            // vibes like "date-night", "casual"
  meal_types: string[]             // "Lunch", "Dinner", "Brunch"
  // ... more fields
}
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

## Environment Variables

Create `.env.local`:
```bash
# Google Gemini API Key
GOOGLE_API_KEY=your_api_key_here

# Feature flags
VITE_CHAT_ENABLED=true
VITE_API_URL=http://localhost:3000/api
```

## Development Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# In another terminal, start Vercel dev server for API
vercel dev --yes --listen 3000
```

Visit `http://localhost:3000`

## Deployment

```bash
# Deploy to Vercel
vercel --prod
```

**Environment variables to set in Vercel:**
- `GOOGLE_API_KEY` - Your Google Gemini API key

## API Endpoint

### POST /api/chat

**Request:**
```json
{
  "message": "Find Japanese restaurants with $$",
  "context": {
    "totalRestaurants": 628,
    "visibleRestaurants": 168,
    "activeFilters": {}
  }
}
```

**Response (Function Call):**
```json
{
  "type": "function_call",
  "message": "Perfect! Let me show you Japanese $$ spots on the map!",
  "function": {
    "name": "filter_map",
    "arguments": {
      "cuisines": ["Japanese"],
      "price_levels": ["$$"]
    }
  }
}
```

**Response (Text Only):**
```json
{
  "type": "text",
  "message": "NYC Restaurant Week runs twice a year..."
}
```

## Performance Optimizations

### Token & Cost Optimization
- **System prompt optimized**: 73% reduction (3,000 → 800 tokens)
- **Redis caching**: Optional caching layer for shared cache across users
- **Rate limiting**: 20 requests/hour per IP to prevent abuse
- **Token usage logging**: Real-time monitoring of API consumption

### Frontend Performance
- Static restaurant data (no database queries)
- Client-side filtering for instant results
- Map marker clustering at low zoom levels
- Lazy loading of restaurant details
- Gemini 2.0 Flash for fast AI responses

### Geographic Features
- **Turf.js integration**: Free, client-side geospatial calculations
- **Neighborhood expansion**: "in and around Kips Bay" includes adjacent areas
- **True midpoint calculation**: "between Williamsburg and Kips Bay" shows actual geographic center
- **30+ neighborhoods** mapped with adjacency relationships
- **Balance scoring**: Restaurants sorted by equal distance from both locations

## Optional: Redis Setup

For production deployments with 500+ users:
1. Create Redis Cloud account (free tier: 30MB)
2. Add `REDIS_URL` environment variable
3. System automatically enables caching with graceful degradation
4. See API documentation for cache TTL configuration

## Future Enhancements

- [ ] Real-time reservation availability
- [ ] User reviews and ratings
- [ ] Dish photo gallery
- [ ] Restaurant comparison tool
- [x] Transit-time-based midpoint calculations (In Progress - Phase 2)
- [ ] Push notifications for favorite restaurants

---

## Development Progress

### 📅 Current Status: Geospatial Enhancement - Phase 2 (60% Complete)

Last updated: 2025-11-19

---

### ✅ **COMPLETED - Phase 1: Geocoding Foundation**

**Implementation Date:** 2025-11-19

#### New Files Created (3)
1. **`/src/utils/nycSlang.ts`** - NYC abbreviation dictionary
   - 70+ slang terms (LIC → Long Island City, FiDi → Financial District, etc.)

2. **`/api/lib/geoapifyClient.js`** - Shared Geoapify HTTP client
   - NYC bounding box filtering, error handling for rate limits

3. **`/api/geocode.js`** - Forward geocoding endpoint
   - Geoapify API integration, 7-day Redis cache, fallback to neighborhood centroids

#### Features Delivered
- ✅ Forward geocoding (address → coordinates)
- ✅ NYC slang support, bounding box filtering
- ✅ Auto-displays restaurant summary after geocoding
- ✅ Improved `get_current_results` function calling

#### Example Queries
```
"Find restaurants near Times Square"
→ Shows summary with cuisines, ratings, top picks

"Show me spots around LIC"
→ Expands to "Long Island City", shows results
```

---

### 🚧 **IN PROGRESS - Phase 2: Hybrid Isochrone System (60% Complete)**

**Implementation Date:** 2025-11-19

#### New Files Created (2)
1. **`/src/services/isochroneService.ts`** - Hybrid isochrone routing
   - Mapbox for walking/cycling (100K/month free)
   - Geoapify for transit (3K credits/day free)
   - Turf.js fallback when quotas exceeded

2. **`/api/isochrone.js`** - Isochrone backend endpoint
   - 24-hour Redis cache, fallback to circular approximation

#### Files Modified
- **`/src/utils/geospatial.ts`** - Added polygon filtering utilities
- **`/api/chat.js`** - Added `find_restaurants_by_travel_time` tool

#### Features Delivered
- ✅ Hybrid isochrone service (Mapbox + Geoapify)
- ✅ Polygon filtering utilities (point-in-polygon, intersection, union)
- ✅ Tool definition with system prompt examples

#### Example Queries (Will work after frontend integration)
```
"Restaurants within 15 minutes walking from Grand Central"
"Places I can reach by subway in 20 minutes from Times Square"
"Italian spots within 10 min walk from my hotel"
```

#### Remaining Work (40%)
1. Add isochrone handler to ChatInterface.tsx (~50 lines)
2. Add polygon visualization to Map.tsx (~80 lines)
   - Pink fill (#FF1493, 20% opacity)
   - Pink outline (2px width)
   - Clear polygon button

**Estimated Time:** 1-2 hours

---

### 📊 **API Cost Analysis**

| Service | Daily Limit | Projected Usage | Status |
|---------|-------------|-----------------|--------|
| Mapbox Isochrones | 3,333/day | ~100 | ✅ 97% available |
| Geoapify Geocoding | 3,000 credits | ~30 | ✅ 99% available |
| Geoapify Isochrones | 3,000 credits | ~200 | ✅ 93% available |

**With caching:** ~230 credits/day total (13x under free tier limit)
**Monthly cost:** $0 (within all free tiers)

---

### 🐛 **Known Issues & Debugging**

1. **Turf.js Import**: Backend may need CommonJS `require()` instead of ES6 `import`
2. **Mapbox Token**: Verify `VITE_MAPBOX_TOKEN` in `.env.local`
3. **Type Errors**: Check `computeResultMetadata()` type consistency
4. **GeoJSON Formats**: May need normalization between Mapbox/Geoapify responses

---

### 📝 **File Inventory**

**New Files (6):** 903 total lines added
- `src/utils/nycSlang.ts`, `src/services/isochroneService.ts`
- `api/lib/geoapifyClient.js`, `api/geocode.js`, `api/isochrone.js`

**Modified Files (3):**
- `api/chat.js` (+65 lines) - 2 new tools
- `src/components/ChatInterface.tsx` (+100 lines) - Geocoding handler
- `src/utils/geospatial.ts` (+59 lines) - Polygon utilities

---

### 🎯 **Next Session Goals**

1. Complete Phase 2 frontend integration
2. Test walking & transit isochrones
3. Fix any TypeScript/runtime errors
4. Verify pink polygon rendering

**Estimated Time to Phase 2 Completion:** 2-3 hours

---

## Credits

- Built by AP, in collaboration with Fulton Ring and Marauders.Earth
- Data sourced from NYC Tourism
- Yelp review summaries generated with AI
- Reddit sentiment from r/FoodNYC

## License

MIT License - See LICENSE file for details
