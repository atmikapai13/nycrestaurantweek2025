# NYC Eats

NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.

---

## Features

- 🗺️ Interactive Mapbox map showing 628+ participating restaurants
- 🤖 AI chatbot powered by Google Gemini for natural language restaurant search
- 🔍 Multi-criteria filtering (cuisine, price, vibes, ratings, awards)
- ⭐ Michelin stars, Bib Gourmand, and NYT Top 100 restaurant highlights
- 📝 Yelp review highlights and Reddit community opinions
- ❤️ Favorites system with shareable URLs and independent highlight mode
- 🎯 Smart marker highlighting: pink markers show search/filter results while keeping all restaurants visible
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

## Available Tools (13 Total)

Gemini has access to 13 function tools it can call based on user queries. These tools are executed **client-side** by the frontend.

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

---

### 🗺️ Geospatial Tools (5)

#### 11. `calculate_midpoint`
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

#### 12. `geocode_address`
**Purpose**: Convert NYC addresses, landmarks, or POIs to coordinates for spatial queries. Understands NYC slang (LIC, FiDi, UWS, etc.).
**Parameters**:
- `address`: NYC address, landmark, neighborhood, or POI (e.g., "Times Square", "123 Broadway Brooklyn", "LIC", "the Vessel")

**Example**:
```javascript
geocode_address({ address: "Times Square" })
geocode_address({ address: "LIC" })  // Expands to "Long Island City"
```

#### 13. `find_restaurants_by_travel_time`
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

#### 14. `find_multi_party_restaurants`
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
- [x] Transit-time-based isochrone calculations
- [ ] Push notifications for favorite restaurants

---

## Development Progress

### 📅 Current Status: Geospatial Features Complete

Last updated: 2025-11-23

---

### ✅ **COMPLETED - Phase 1: Geocoding Foundation**

**Implementation Date:** 2025-11-19

#### Features Delivered
- ✅ Forward geocoding (address → coordinates) via Geoapify API
- ✅ NYC slang support (70+ terms: LIC, FiDi, UWS, etc.)
- ✅ NYC bounding box filtering
- ✅ 7-day Redis cache for geocode results
- ✅ Fallback to neighborhood centroids

---

### ✅ **COMPLETED - Phase 2: Hybrid Isochrone System**

**Implementation Date:** 2025-11-19 – 2025-11-23

#### Features Delivered
- ✅ Hybrid isochrone service (Mapbox for walking/cycling, Geoapify for transit)
- ✅ Single-person travel-time queries (`find_restaurants_by_travel_time`)
- ✅ Multi-party spatial queries (`find_multi_party_restaurants`)
- ✅ Spatial operations: intersection (overlap), union (combined), exclusion (difference)
- ✅ Polygon visualization on map with clear button
- ✅ Point-in-polygon filtering for restaurant results
- ✅ 24-hour Redis cache for isochrone results
- ✅ Turf.js fallback when API quotas exceeded

#### Example Queries
```
"Restaurants within 15 minutes walking from Grand Central"
"Places I can reach by subway in 20 minutes from Times Square"
"I'm at the Vessel, friend at LIC, what's between us?"
"Show places near Times Square but avoid Penn Station"
```

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

## Credits

- Built by AP, in collaboration with Fulton Ring and Marauders.Earth
- Data sourced from NYC Tourism
- Yelp review summaries generated with AI
- Reddit sentiment from r/FoodNYC

## License

MIT License - See LICENSE file for details
