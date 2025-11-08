# Chatbot Integration Action Plan

## Overview

This document outlines the plan to integrate a Gemini-powered chatbot into NYC Eats with zero downtime and no breaking changes.

## Architecture Goals

- **Progressive Enhancement**: Build chat as optional layer on existing functionality
- **Non-Breaking**: All existing features continue working unchanged
- **Feature-Flagged**: Chat can be enabled/disabled via environment variable
- **Separation of Concerns**: API on Vercel, static site on GitHub Pages

---

## Technology Stack

### Backend
- **Gemini 2.0 Flash**: FREE tier (15 RPM, 1M tokens/day)
- **Vercel Edge Functions**: Serverless API endpoints
- **Function Calling**: Dynamic map updates via tool use

### Frontend
- **React + TypeScript**: Existing stack (unchanged)
- **Feature Flags**: Environment-based toggles
- **Additive Components**: New components don't modify existing ones

### Cost Analysis
- Gemini 2.0 Flash: **FREE** for expected traffic (up to 21,600 queries/day)
- Vercel: Free tier sufficient for API hosting
- **Estimated cost: $0/month** for initial launch

---

## Query Scenarios

### 1. Location-based filtering
**Query**: "I'm in Williamsburg, my friend's in Midtown. Find Japanese $$ spots"

**Flow**:
- Geocode neighborhoods → Calculate midpoint
- Filter by cuisine + price + proximity
- Gemini calls `calculate_midpoint` function
- Frontend updates map center and filters

### 2. Dish recommendations
**Query**: "What are some dish recommendations from Yelpers for Dhamaka restaurant?"

**Flow**:
- Find restaurant in FinalData.json
- Extract `yelp_review_highlights` field
- Parse dish mentions with percentages
- Gemini calls `show_dish_recommendations` function
- Frontend displays dishes + focuses map on restaurant

### 3. Vibe-based matching
**Query**: "I want to try a date night restaurant in Hell's Kitchen. Cozy vibes please"

**Flow**:
- Semantic matching against `yelp_review_highlights` + `reddit` fields
- Filter by neighborhood + ambiance keywords
- Gemini calls `filter_map` with vibes parameter
- Frontend applies filters + highlights matching restaurants

---

## Data Structure

All required data is consolidated in `src/data/FinalData.json`:

```typescript
interface Restaurant {
  name: string
  slug: string
  neighborhood: string
  cuisine: string
  price: string
  latitude: number
  longitude: number

  // Yelp data (already in FinalData.json)
  yelp_rating: number
  yelp_review_count: number
  yelp_review_highlights: string  // ✅ Dish mentions + percentages

  // Reddit data (already in FinalData.json)
  reddit?: string  // ✅ Community sentiment

  // Awards
  michelin_award?: 'BIB_GOURMAND' | 'ONE_STAR' | 'TWO_STARS' | 'THREE_STARS'
  nyttop100_rank?: number

  // Reservations (future)
  opentable_id?: string  // ✅ Already present, ready for Phase 2
}
```

**No data merging needed** - everything is already in FinalData.json!

---

## File Structure

```
Current Site (untouched)
├── src/
│   ├── App.tsx (existing filters, map)
│   ├── components/
│   │   ├── Filters.tsx          ✅ Keep working
│   │   ├── Map.tsx              ✅ Keep working
│   │   └── RestaurantCard.tsx   ✅ Keep working
│   └── data/FinalData.json      ✅ Already has everything

New Chat Layer (additive only)
├── api/                          [NEW - Vercel Functions]
│   └── chat.ts                   [NEW - Gemini endpoint]
├── src/
│   ├── components/
│   │   └── ChatInterface.tsx     [NEW - Independent component]
│   ├── services/
│   │   └── chatService.ts        [NEW - API calls]
│   ├── hooks/
│   │   └── useChatMap.ts         [NEW - Map controls]
│   └── config/
│       └── features.ts           [NEW - Feature flags]
```

---

## Implementation Steps

### Step 1: Create Feature Branch (30 seconds)

```bash
# Create a new branch for chat feature
git checkout -b feature/chat-integration

# This keeps main branch (production) untouched
```

---

### Step 2: Set Up Vercel (5 minutes)

**Current setup**:
- GitHub Pages: Hosts static site at nyceats.live
- Vercel (new): Will host API endpoints only

```bash
# Install Vercel CLI
npm install -g vercel

# Initialize Vercel project (in your repo)
vercel init

# This creates:
# - vercel.json (config)
# - api/ folder (serverless functions)
```

**Create `vercel.json`**:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "functions": {
    "api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "env": {
    "GOOGLE_API_KEY": "@google_api_key"
  }
}
```

**How this works**:
- Static site: Still deploys to GitHub Pages (nyceats.live)
- API: Deploys to Vercel (auto-generated URL)
- **No conflict** - they run separately

---

### Step 3: Build Chat Component (30 minutes)

**Add feature flag**:

```typescript
// src/config/features.ts [NEW FILE]
export const FEATURES = {
  CHAT_ENABLED: import.meta.env.VITE_CHAT_ENABLED === 'true'
}
```

**Environment files**:
```bash
# .env.local (for local dev)
VITE_CHAT_ENABLED=true
VITE_API_URL=http://localhost:3000/api

# .env.production (for production, initially false)
VITE_CHAT_ENABLED=false
VITE_API_URL=https://your-project.vercel.app/api
```

**Modify App.tsx (non-breaking)**:
```typescript
// src/App.tsx
import { FEATURES } from './config/features'
import ChatInterface from './components/ChatInterface' // NEW

function App() {
  // ... existing state and logic (UNCHANGED)

  return (
    <div className="app">
      <Header />

      <div className="filter-bar-container">
        <Filters {...existingProps} />
      </div>

      <div className="map-section">
        <Map {...existingProps} />

        {selectedRestaurant && (
          <div className="restaurant-card-overlay">
            <RestaurantCard {...existingProps} />
          </div>
        )}
      </div>

      {/* NEW: Chat interface (only shows if flag enabled) */}
      {FEATURES.CHAT_ENABLED && (
        <ChatInterface
          restaurants={filteredRestaurants}
          onFilterChange={handleFilterChange}
          onRestaurantSelect={handleRestaurantSelect}
          onMapAction={handleMapAction} // NEW callback
        />
      )}
    </div>
  )
}
```

**Benefits**:
- ✅ Existing code untouched
- ✅ Chat is completely optional
- ✅ Can test in dev before enabling in prod
- ✅ Easy to disable if bugs found

---

### Step 4: Add Map Control Hook (20 minutes)

Create a hook that **extends** existing map functionality:

```typescript
// src/hooks/useChatMap.ts [NEW FILE]
import { useCallback } from 'react'
import type { Map } from 'mapbox-gl'
import type { Restaurant } from '../types/restaurant'

interface ChatMapActions {
  focusOnRestaurants: (restaurantIds: string[]) => void
  resetFocus: () => void
  flyToLocation: (coords: [number, number], zoom: number) => void
}

export function useChatMap(
  map: Map | null,
  restaurants: Restaurant[]
): ChatMapActions {

  const focusOnRestaurants = useCallback((restaurantIds: string[]) => {
    if (!map) return

    const focused = restaurants.filter(r => restaurantIds.includes(r.slug))

    // Calculate bounds
    if (focused.length > 0) {
      const bounds = calculateBounds(focused)
      map.fitBounds(bounds, { padding: 50, duration: 1000 })
    }
  }, [map, restaurants])

  const resetFocus = useCallback(() => {
    if (!map) return
    // Reset to original view
    map.flyTo({ center: [-73.9712, 40.7831], zoom: 11 })
  }, [map])

  const flyToLocation = useCallback((coords, zoom) => {
    if (!map) return
    map.flyTo({ center: coords, zoom, duration: 1500 })
  }, [map])

  return { focusOnRestaurants, resetFocus, flyToLocation }
}

function calculateBounds(restaurants: Restaurant[]) {
  // Calculate bounding box for multiple restaurants
  const lngs = restaurants.map(r => r.longitude).filter(Boolean)
  const lats = restaurants.map(r => r.latitude).filter(Boolean)

  return [
    [Math.min(...lngs), Math.min(...lats)], // Southwest
    [Math.max(...lngs), Math.max(...lats)]  // Northeast
  ]
}
```

**This hook doesn't modify Map.tsx** - it just uses the existing map instance.

---

### Step 5: Build Gemini API Endpoint (45 minutes)

```typescript
// api/chat.ts [NEW FILE]
import { GoogleGenerativeAI } from '@google/generative-ai'

const TOOL_DEFINITIONS = {
  functionDeclarations: [
    {
      name: 'filter_map',
      description: 'Filter restaurants and update map view',
      parameters: {
        type: 'object',
        properties: {
          neighborhoods: {
            type: 'array',
            items: { type: 'string' },
            description: 'NYC neighborhoods like "Hell\'s Kitchen", "Williamsburg"'
          },
          cuisines: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cuisine types like "Japanese", "Italian", "Indian"'
          },
          price_levels: {
            type: 'array',
            items: { type: 'string', enum: ['$', '$$', '$$$', '$$$$'] }
          },
          vibes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ambiance keywords like "cozy", "romantic", "date night", "casual"'
          },
          min_rating: {
            type: 'number',
            description: 'Minimum Yelp rating (0-5)'
          }
        }
      }
    },
    {
      name: 'show_dish_recommendations',
      description: 'Display Yelp dish recommendations for a specific restaurant',
      parameters: {
        type: 'object',
        properties: {
          restaurant_slug: {
            type: 'string',
            description: 'Restaurant slug identifier (lowercase, hyphenated)'
          }
        },
        required: ['restaurant_slug']
      }
    },
    {
      name: 'calculate_midpoint',
      description: 'Find restaurants at the geographic midpoint between two NYC locations',
      parameters: {
        type: 'object',
        properties: {
          location1: {
            type: 'string',
            description: 'First NYC neighborhood or location'
          },
          location2: {
            type: 'string',
            description: 'Second NYC neighborhood or location'
          },
          cuisines: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional cuisine filters'
          },
          price_levels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional price filters'
          }
        },
        required: ['location1', 'location2']
      }
    }
  ]
}

export default async function handler(req, res) {
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { message, context } = req.body

    if (!message || !context) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: buildSystemPrompt(context),
      tools: [TOOL_DEFINITIONS]
    })

    const result = await model.generateContent(message)
    const response = result.response

    // Parse function calls
    if (response.functionCalls && response.functionCalls.length > 0) {
      const functionCall = response.functionCalls[0]

      return res.json({
        type: 'function_call',
        message: response.text() || '',
        function: {
          name: functionCall.name,
          arguments: functionCall.args
        }
      })
    }

    // Regular text response
    return res.json({
      type: 'text',
      message: response.text()
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return res.status(500).json({
      error: 'Failed to process chat request',
      details: error.message
    })
  }
}

function buildSystemPrompt(context) {
  return `You are an AI assistant for NYC Eats, helping users discover restaurants during NYC Restaurant Week.

Available data:
- ${context.totalRestaurants} NYC restaurants
- Yelp ratings, review highlights with dish mentions (in "yelp_review_highlights" field)
- Reddit community opinions (in "reddit" field)
- Michelin awards and NYT Top 100 rankings
- Exact coordinates for mapping

Current context:
- Viewing: ${context.visibleRestaurants} restaurants
- Active filters: ${JSON.stringify(context.activeFilters)}

User queries fall into these categories:

1. Location-based filtering: "Find Japanese spots between Williamsburg and Midtown"
   → Use calculate_midpoint function
   → Provide conversational response about midpoint location

2. Dish recommendations: "What do Yelpers recommend at Dhamaka?"
   → Use show_dish_recommendations function
   → Extract specific dishes from yelp_review_highlights
   → Cite percentages and include Reddit sentiment if available

3. Vibe matching: "Cozy date night spot in Hell's Kitchen"
   → Use filter_map function with vibes parameter
   → Map ambiance keywords to restaurant characteristics
   → Consider price range appropriate for occasion

Guidelines:
- Be conversational and friendly
- Always cite sources (Yelp percentages, Reddit sentiment, awards)
- Provide specific dish names when available
- Mention Michelin/NYT rankings when relevant
- If unsure about a restaurant name, ask for clarification
- Suggest 3-5 options when multiple restaurants match`
}
```

---

### Step 6: Build Chat Service Layer (20 minutes)

```typescript
// src/services/chatService.ts [NEW FILE]
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatContext {
  totalRestaurants: number
  visibleRestaurants: number
  activeFilters: Record<string, any>
}

interface ChatResponse {
  type: 'text' | 'function_call'
  message: string
  function?: {
    name: string
    arguments: Record<string, any>
  }
}

const API_URL = import.meta.env.VITE_API_URL || '/api'

export async function sendChatMessage(
  message: string,
  context: ChatContext
): Promise<ChatResponse> {
  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      context
    })
  })

  if (!response.ok) {
    throw new Error(`Chat API error: ${response.statusText}`)
  }

  return response.json()
}
```

---

### Step 7: Build ChatInterface Component (30 minutes)

```typescript
// src/components/ChatInterface.tsx [NEW FILE]
import { useState, useRef, useEffect } from 'react'
import { sendChatMessage } from '../services/chatService'
import type { Restaurant } from '../types/restaurant'
import './ChatInterface.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatInterfaceProps {
  restaurants: Restaurant[]
  onFilterChange: (filterType: string, values: string[]) => void
  onRestaurantSelect: (restaurant: Restaurant) => void
  onMapAction: (action: MapAction) => void
}

interface MapAction {
  type: 'focus' | 'flyTo' | 'reset'
  data?: any
}

export default function ChatInterface({
  restaurants,
  onFilterChange,
  onRestaurantSelect,
  onMapAction
}: ChatInterfaceProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I can help you find restaurants. Try asking me:\n• "Find Japanese spots between Williamsburg and Midtown"\n• "What do Yelpers recommend at Dhamaka?"\n• "Cozy date night spot in Hell\'s Kitchen"'
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const response = await sendChatMessage(userMessage, {
        totalRestaurants: restaurants.length,
        visibleRestaurants: restaurants.length,
        activeFilters: {}
      })

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.message
      }])

      // Handle function calls
      if (response.type === 'function_call' && response.function) {
        handleFunctionCall(response.function)
      }

    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.'
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleFunctionCall = (func: { name: string, arguments: any }) => {
    switch (func.name) {
      case 'filter_map':
        // Apply filters to map
        if (func.arguments.cuisines) {
          onFilterChange('Cuisine', func.arguments.cuisines)
        }
        if (func.arguments.price_levels) {
          onFilterChange('Price', func.arguments.price_levels)
        }
        if (func.arguments.neighborhoods) {
          onFilterChange('Neighborhood', func.arguments.neighborhoods)
        }
        break

      case 'show_dish_recommendations':
        // Focus on specific restaurant
        const restaurant = restaurants.find(
          r => r.slug === func.arguments.restaurant_slug
        )
        if (restaurant) {
          onRestaurantSelect(restaurant)
          onMapAction({ type: 'flyTo', data: restaurant })
        }
        break

      case 'calculate_midpoint':
        // TODO: Implement midpoint calculation
        console.log('Midpoint calculation:', func.arguments)
        break
    }
  }

  return (
    <>
      {/* Floating chat button */}
      <button
        className={`chat-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle chat"
      >
        💬
      </button>

      {/* Chat window */}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <h3>NYC Eats Assistant</h3>
            <button onClick={() => setIsOpen(false)}>✕</button>
          </div>

          <div className="chat-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-content">{msg.content}</div>
              </div>
            ))}
            {isLoading && (
              <div className="message assistant">
                <div className="message-content typing">...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask me about restaurants..."
              disabled={isLoading}
            />
            <button onClick={handleSend} disabled={isLoading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
```

---

### Step 8: Testing Strategy

**Local Development**:

```bash
# Terminal 1: Run local dev server
npm run dev
# Site runs at http://localhost:5173

# Terminal 2: Run Vercel dev (for API)
vercel dev
# API runs at http://localhost:3000/api/chat

# Update .env.local to point to local API
VITE_API_URL=http://localhost:3000/api
VITE_CHAT_ENABLED=true
```

**Test Checklist**:
- ✅ Existing filters still work
- ✅ Map interactions unchanged
- ✅ Chat button appears (if flag enabled)
- ✅ Chat can send messages
- ✅ Filter updates from chat work
- ✅ Map focuses on chat results
- ✅ Can toggle chat on/off
- ✅ Site works with chat disabled

---

### Step 9: Gradual Rollout

**Week 1: Deploy API to Vercel**
```bash
vercel --prod
# Deploys API to https://your-project.vercel.app/api/chat
```

**Week 2: Test with feature flag (hidden from users)**
```bash
# Deploy frontend to GitHub Pages with chat code but flag=false
VITE_CHAT_ENABLED=false npm run build && npm run deploy
```

**Week 3: Enable for beta testing**
- Enable flag for specific users via URL param
- `nyceats.live?beta=true` shows chat

**Week 4: Full launch**
```bash
# Enable for everyone
VITE_CHAT_ENABLED=true npm run build && npm run deploy
```

---

## Future Enhancements

### Phase 2: OpenTable Integration

**Architecture changes needed**:
```typescript
// Add new function to tool definitions
{
  name: 'check_availability',
  description: 'Check real-time table availability via OpenTable',
  parameters: {
    type: 'object',
    properties: {
      restaurant_opentable_id: { type: 'string' },
      date: { type: 'string' },
      time: { type: 'string' },
      party_size: { type: 'number' }
    }
  }
}
```

**Data already prepared**:
- ✅ `opentable_id` field exists in FinalData.json
- ✅ Just need OpenTable API key and integration

**User flow**:
```
User: "Find date night spots in Hell's Kitchen"
  ↓
Bot: "Found 5 great spots! [Shows restaurants]
     Would you like to check availability?"
  ↓
[User clicks "Check Availability" button]
  ↓
Bot: "The Modern has tables at 7:00 PM and 8:30 PM.
     [Book 7:00 PM] [Book 8:30 PM]"
```

---

## Troubleshooting

### Chat button doesn't appear
- Check `VITE_CHAT_ENABLED=true` in `.env.local`
- Verify feature flag import in App.tsx
- Check browser console for errors

### API calls fail
- Verify Vercel deployment: `vercel ls`
- Check API URL in `.env.local`
- Test endpoint: `curl -X POST http://localhost:3000/api/chat`
- Verify GOOGLE_API_KEY is set in Vercel dashboard

### Gemini API errors
- Check API key is valid
- Verify free tier limits not exceeded (15 RPM)
- Check request format matches Gemini SDK docs

### Map doesn't update from chat
- Verify function call parsing in ChatInterface
- Check `onFilterChange` prop is passed correctly
- Console.log function arguments to debug

---

## Dependencies to Add

```bash
npm install @google/generative-ai
```

---

## Estimated Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Setup | 30 min | Feature branch, Vercel init, env vars |
| API Endpoint | 1 hour | Gemini integration, tool definitions |
| Chat UI | 1 hour | Component, styling, message handling |
| Integration | 1 hour | Wire to map, filters, restaurant cards |
| Testing | 1 hour | All three query scenarios |
| **Total** | **4-5 hours** | Full working prototype |

---

## Success Metrics

**Phase 1 (MVP Launch)**:
- Chat appears and responds
- 3 query types work (location, dishes, vibes)
- Map updates dynamically
- Zero breaking changes to existing features
- Cost: $0/month

**Phase 2 (OpenTable)**:
- Availability checks work
- Booking flow complete
- Cost: Still ~$0-5/month

---

## Notes

- All data needed is already in FinalData.json
- No separate data files to merge
- Gemini 1M token context means we can send entire dataset
- Function calling handles all dynamic map updates
- Feature flag allows gradual rollout
- Completely non-breaking to existing site
