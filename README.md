# NYC Eats - Restaurant Week Discovery Tool

I've seen a ton of Reddit posts disparaging restaurant week, lamenting that many of the restaurants and deals aren't worth the price. Here's a map that:
1. Visualizes participating restaurants
2. Brings together restaurant week offerings (price, menu, meal types) all in one place
3. Combines foodie recommendations and lists, chiefly Michelin, Bib Gourmand, and NYT Top 100 Restaurants, to help people identify restaurants worth visiting

Happy eating!

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
- **CSS3** - Styling

### Backend
- **Vercel Edge Functions** - Serverless API hosting
- **Google Gemini 2.0 Flash** - AI for natural language processing
- **Node.js** - Runtime

### Data
- **Static JSON** - Restaurant data with Yelp reviews, Reddit sentiment, awards, coordinates

## Project Structure

```
nycrestaurantweek2025/
├── src/
│   ├── components/
│   │   ├── App.tsx                 # Main app component, filter orchestration
│   │   ├── Map.tsx                 # Mapbox map with restaurant markers
│   │   ├── ChatInterface.tsx       # AI chatbot UI and logic
│   │   ├── Filters.tsx             # Filter controls UI
│   │   ├── RestaurantCard.tsx      # Restaurant detail card
│   │   └── Header.tsx              # App header
│   │
│   ├── data/
│   │   └── FinalData.json          # Restaurant data (628 entries)
│   │
│   ├── services/
│   │   └── chatService.ts          # API client for chat endpoint
│   │
│   ├── types/
│   │   └── restaurant.ts           # TypeScript interfaces
│   │
│   └── config/
│       └── features.ts             # Feature flags
│
├── api/
│   └── chat.js                     # Gemini AI endpoint (Vercel Function)
│
├── public/
│   ├── remi.png                    # Chatbot avatar
│   └── user_bot.png                # User avatar
│
└── vercel.json                     # Vercel deployment config
```

## How the AI Chatbot Works

### 1. User Input Flow

```
User types: "Find Japanese restaurants with $$"
     ↓
ChatInterface.tsx (handleSend)
     ↓
POST /api/chat with:
{
  message: "Find Japanese restaurants with $$",
  context: {
    totalRestaurants: 628,
    visibleRestaurants: 168,
    activeFilters: {}
  }
}
```

### 2. Gemini AI Processing

**Input to Gemini:**
- **System Instruction**: Detailed prompt explaining how to parse restaurant queries
- **Tool Definitions**: Available functions (filter_map, show_dish_recommendations, calculate_midpoint)
- **User Message**: The actual query

**Gemini's Job:**
Extract structured filter criteria from natural language:
```javascript
// User: "Find Japanese restaurants with $$"
// Gemini extracts:
{
  cuisines: ["Japanese"],
  price_levels: ["$$"]
}
```

### 3. Response Handling

**API returns to frontend:**
```javascript
{
  type: 'function_call',
  message: 'Perfect! Let me show you Japanese $$ spots on the map!',
  function: {
    name: 'filter_map',
    arguments: {
      cuisines: ['Japanese'],
      price_levels: ['$$']
    }
  }
}
```

### 4. Filter Application

**ChatInterface.tsx** executes the function:
```javascript
if (func.arguments.cuisines) {
  onFilterChange('Cuisine', ['Japanese'])
}
if (func.arguments.price_levels) {
  onFilterChange('Price', ['$$'])
}
```

### 5. Restaurant Filtering (AND Logic)

**App.tsx** combines all filters:
```javascript
// Start: 628 restaurants
filtered = restaurants.filter(r => {
  // Filter 1: Cuisine
  if (!r.cuisine.toLowerCase().includes('japanese')) return false

  // Filter 2: Price
  if (r.price !== '$$') return false

  return true  // Must pass ALL filters
})
// Result: ~15 restaurants matching BOTH criteria
```

### 6. Map Update

**Map.tsx** displays filtered restaurants:
- Updates markers on map
- Shows only restaurants matching all active filters

## Filter Types Supported

### Categorical Filters
- **Cuisine**: Japanese, Italian, Indian, Seafood, etc.
- **Price**: $, $$, $$$, $$$$
- **Vibes**: date-night, romantic, casual, cozy, lively
- **Neighborhoods**: Williamsburg, Hell's Kitchen, Upper West Side, etc.
- **Badges**: Michelin stars, Bib Gourmand, NYT Top 100
- **Rating**: Minimum Yelp rating (0-5 stars)

### Semantic Search
- **Semantic Features**: Searches Yelp review highlights for keywords
  - Example: "restaurants with good cocktails" → searches for "cocktails" in reviews

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

- Static restaurant data (no database queries)
- Client-side filtering for instant results
- Map marker clustering at low zoom levels
- Lazy loading of restaurant details
- Gemini Flash model for fast AI responses

## Future Enhancements

- [ ] Real-time reservation availability
- [ ] User reviews and ratings
- [ ] Dish photo gallery
- [ ] Restaurant comparison tool
- [ ] Route planning for multi-restaurant visits
- [ ] Push notifications for favorite restaurants

## Credits

- Built by Atmika Pai
- Data sourced from NYC Tourism
- Yelp review summaries generated with AI
- Reddit sentiment from r/FoodNYC

## License

MIT License - See LICENSE file for details
