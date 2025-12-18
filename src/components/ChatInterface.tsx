import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { sendChatMessage, type GeminiMessage } from '../services/chatService'
import type { Restaurant } from '../types/restaurant'
import { API_CONFIG } from '../config/features'
import { calculateTrueMidpoint, getNeighborhoodCenter, findRestaurantsWithinRadius, expandNeighborhoodSearch, filterRestaurantsByPolygon, intersectPolygons, unionPolygons, excludePolygon } from '../utils/geospatial'
import { getIsochrone } from '../services/isochroneService'
import type { IsochroneLayer } from './Map'
import RestaurantCard from './RestaurantCard'
import './ChatInterface.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
  type?: 'text' | 'restaurant_card'
  restaurant?: Restaurant
}

// Expose methods to parent component
export interface ChatInterfaceHandle {
  addRestaurantCard: (restaurant: Restaurant) => void
}

/**
 * Computes aggregate metadata from restaurant array for intelligent summaries
 * Performance: O(n) single pass, ~5-10ms for 628 restaurants
 */
function computeResultMetadata(restaurants: Restaurant[]) {
  if (restaurants.length === 0) {
    return {
      total_count: 0,
      message: "No restaurants match your current filters."
    }
  }

  const metadata: Record<string, any> = {
    total_count: restaurants.length,
    cuisine_breakdown: {} as Record<string, number>,
    top_cuisines: [] as string[],
    borough_breakdown: {} as Record<string, number>,
    top_neighborhoods: [] as string[],
    price_breakdown: { "$": 0, "$$": 0, "$$$": 0, "$$$$": 0 },
    avg_rating: 0,
    rating_range: [5, 0] as [number, number],
    michelin_count: 0,
    michelin_types: [] as string[],
    nyt_count: 0,
    collections_present: [] as string[],
    has_awards: false
  }

  let totalRating = 0
  let ratingCount = 0
  const neighborhoodCounts: Record<string, number> = {}
  const collectionSet = new Set<string>()
  const michelinSet = new Set<string>()

  // Single pass through restaurants
  restaurants.forEach(r => {
    // Cuisine
    if (r.cuisine) {
      metadata.cuisine_breakdown[r.cuisine] = (metadata.cuisine_breakdown[r.cuisine] || 0) + 1
    }

    // Borough
    if (r.borough) {
      metadata.borough_breakdown[r.borough] = (metadata.borough_breakdown[r.borough] || 0) + 1
    }

    // Neighborhood
    if (r.neighborhood) {
      neighborhoodCounts[r.neighborhood] = (neighborhoodCounts[r.neighborhood] || 0) + 1
    }

    // Price
    if (r.price && r.price in metadata.price_breakdown) {
      metadata.price_breakdown[r.price as keyof typeof metadata.price_breakdown]++
    }

    // Rating
    if (r.yelp_rating && r.yelp_rating > 0) {
      totalRating += r.yelp_rating
      ratingCount++
      metadata.rating_range[0] = Math.min(metadata.rating_range[0], r.yelp_rating)
      metadata.rating_range[1] = Math.max(metadata.rating_range[1], r.yelp_rating)
    }

    // Awards
    if (r.michelin_award) {
      metadata.michelin_count++
      michelinSet.add(r.michelin_award)
      metadata.has_awards = true
    }

    if (r.nyttop100_rank) {
      metadata.nyt_count++
      metadata.has_awards = true
    }

    // Collections
    r.collections?.forEach(c => collectionSet.add(c))
  })

  // Compute derived fields
  metadata.avg_rating = ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0

  // Top 3 cuisines
  metadata.top_cuisines = Object.entries(metadata.cuisine_breakdown)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3)
    .map(([cuisine]) => cuisine)

  // Top 3 neighborhoods
  metadata.top_neighborhoods = Object.entries(neighborhoodCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([hood]) => hood)

  metadata.michelin_types = Array.from(michelinSet)
  metadata.collections_present = Array.from(collectionSet)

  return metadata
}

/**
 * Formats restaurant results into a consistent summary format
 * Used by all tools to ensure uniform output
 */
function formatResultsSummary(
  restaurants: Restaurant[],
  contextMessage: string,
  options: {
    includeExamples?: boolean
    closingMessage?: string
  } = {}
): string {
  const {
    includeExamples = true,
    closingMessage = "If you want to learn more, click on a restaurant with a pink marker or ask me questions."
  } = options

  const metadata = computeResultMetadata(restaurants)

  // Get top 3 examples (sorted by rating)
  let examples: string[] = []
  if (includeExamples && restaurants.length > 0) {
    const sorted = restaurants.slice().sort((a, b) => (b.yelp_rating || 0) - (a.yelp_rating || 0))
    examples = sorted.slice(0, 3).map(r => r.name)
  }

  // Start with context message
  let summary = contextMessage

  // Add top-rated examples immediately after context
  if (examples.length > 0) {
    summary += ` Top-rated restaurants are ${examples.join(', ')}.`
  }

  // Build breakdown section
  let breakdownParts: string[] = []

  // Average rating
  if (metadata.avg_rating > 0) {
    breakdownParts.push(`Average rating: ${metadata.avg_rating}⭐`)
  }

  // Price distribution
  const priceEntries = Object.entries(metadata.price_breakdown).filter(([, count]) => (count as number) > 0)
  if (priceEntries.length > 0) {
    const priceDetails = priceEntries.map(([price, count]) => `${count} ${price}`).join(', ')
    breakdownParts.push(`Price distribution: ${priceDetails}`)
  }

  // Cuisines
  if (metadata.top_cuisines && metadata.top_cuisines.length > 0) {
    breakdownParts.push(`Top Cuisines: ${metadata.top_cuisines.join(', ')}`)
  }

  // Awards
  const awards: string[] = []
  if (metadata.michelin_count > 0) {
    awards.push(`${metadata.michelin_count} Michelin-starred`)
  }
  if (metadata.nyt_count > 0) {
    awards.push(`${metadata.nyt_count} NYT Top 100`)
  }
  if (awards.length > 0) {
    breakdownParts.push(`Awards: ${awards.join(', ')}`)
  }

  // Add breakdown if there are details
  if (breakdownParts.length > 0) {
    summary += `\n\nHere's a further breakdown:\n• ${breakdownParts.join('\n• ')}`
  }

  // Add closing message
  summary += `\n\n${closingMessage}`

  return summary
}

interface ChatInterfaceProps {
  restaurants: Restaurant[]
  allRestaurants: Restaurant[]
  onFilterChange: (filterType: string, values: string[]) => void
  onRestaurantSelect: (restaurant: Restaurant) => void
  onMapFocus?: (restaurantIds: string[]) => void
  selectedRestaurant?: Restaurant | null
  onIsochroneUpdate?: (polygon: any) => void
  onIsochroneLayersUpdate?: (layers: IsochroneLayer[]) => void
  onResetAll?: () => void
  isochroneRegionSlugs?: string[] | null
  onIsochroneRegion?: (slugs: string[] | null) => void
  favorites?: string[]
  onToggleFavorite?: (restaurantName: string) => void
  favoritesActive?: boolean
  onFavoritesToggle?: () => void
}

const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(({
  restaurants,
  allRestaurants,
  onFilterChange,
  onRestaurantSelect,
  onMapFocus,
  selectedRestaurant,
  onIsochroneUpdate,
  onIsochroneLayersUpdate,
  onResetAll,
  isochroneRegionSlugs,
  onIsochroneRegion,
  favorites = [],
  onToggleFavorite,
  favoritesActive = false,
  onFavoritesToggle
}, ref) => {
  // Random welcome message selection
  const welcomeMessages = [
    'Welcome to NYC Eats! I\'m Remi, your rodent sommelier of the NYC dining scene. Unlike my cousins in the subway, I\'ve been vector-embedded with thousands of Yelp reviews and have a rather refined palate for semantic similarity. What are we looking for today?',
    'Welcome to NYC Eats! I\'m Remi, your rodent sommelier of the NYC dining scene. You\'re in New York, where the only real sin is eating somewhere forgettable. Give me a neighborhood, a mood, or a friend you\'re meeting halfway—I\'ll point you toward the right places.',
    'Welcome to NYC Eats! I\'m Remi, your rodent sommelier of the NYC dining scene. I\'m here to help you find the sort of restaurant that lingers — the way a good Barolo does. Give me a neighborhood or a mood, and I\'ll pour you a shortlist worth considering.'
  ]

  // Quick-start suggestions for new users
  const suggestions = [
    "I'm in Soho, hunting for a great $$ date spot I can reach in under 15 min transit. What's on the menu, Remi?",
    "My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min walk?",
    "Remi, surprise me — give me three places that nail ambiance without being stuffy."
  ]

  // Meta-learning suggestions shown after buy-me-coffee messages
  const metaLearningSuggestions = [
    "How do you work, Remi?",
    "What was the genesis of this project?"
  ]

  // Helper function to detect buy-me-coffee messages
  const isBuyMeCoffeeMessage = (content: string): boolean => {
    return content.toLowerCase().includes('buymeacoffee.com/atmikapai');
  }

  // Chat is always open now (no toggle)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
    }
  ])
  const [conversationHistory, setConversationHistory] = useState<GeminiMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // Store visible restaurants from last response for state persistence
  const [lastVisibleRestaurants, setLastVisibleRestaurants] = useState<Restaurant[]>([])
  // Store isochrone params from last response for state persistence
  const [lastIsochroneParams, setLastIsochroneParams] = useState<any>(null)

  // Phase 3: Polygon cache for multi-party spatial operations
  const [polygonCache, setPolygonCache] = useState<Record<string, {
    polygon: any
    metadata: {
      location: string
      mode?: string
      travel_time?: number
    }
  }>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mobile drawer state
  const [drawerHeight, setDrawerHeight] = useState< 35 | 80>(35)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartHeight, setDragStartHeight] = useState(30)
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)
  const [showResetConfirmation, setShowResetConfirmation] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Auto-scroll only when Remi responds (not on page load or user messages)
  const prevMessagesLengthRef = useRef(messages.length)

  useEffect(() => {
    // Skip scroll on initial render/page load
    if (prevMessagesLengthRef.current === 0 && messages.length > 0) {
      prevMessagesLengthRef.current = messages.length
      return
    }

    // Only scroll if messages increased AND last message is from assistant (Remi)
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        scrollToBottom()
      }
      prevMessagesLengthRef.current = messages.length
    }
  }, [messages])

  useEffect(() => {
    // Auto-focus input on mount
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // Expose addRestaurantCard method to parent via ref
  const addRestaurantCard = (restaurant: Restaurant) => {
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      type: 'restaurant_card',
      restaurant
    }])
  }

  useImperativeHandle(ref, () => ({
    addRestaurantCard
  }))

  // Convert markdown and URLs in text to HTML
  const linkifyText = (text: string): string => {
    let result = text

    // First, handle markdown list items (must be done before bold/italic)
    // Convert markdown list items: "* item" or "- item" → bullet point
    result = result.replace(/^[\*\-]\s+(.+)$/gm, '• $1')

    // Then, handle markdown formatting
    // Bold: **text** → <strong>text</strong>
    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

    // Italic: *text* → <em>text</em> (but not if it's part of **)
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')

    // Then, handle URLs with protocol (http:// or https://)
    result = result.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">$1</a>')

    // Finally, handle URLs without protocol (like buymeacoffee.com/atmikapai)
    // Match domain.tld/path but avoid matching already-linked URLs
    result = result.replace(/(?<!href="|">)(?:^|\s)((?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)/g, (match, url, offset) => {
      // Check if this URL is already inside an href attribute
      const beforeMatch = result.substring(0, offset)
      if (beforeMatch.lastIndexOf('<a') > beforeMatch.lastIndexOf('</a>')) {
        return match // Already inside a link tag
      }
      return match.replace(url, `<a href="https://${url}" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">${url}</a>`)
    })

    return result
  }

  // Mobile drawer touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true)
    setDragStartY(e.touches[0].clientY)
    setDragStartHeight(drawerHeight)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return

    const currentY = e.touches[0].clientY
    const deltaY = dragStartY - currentY // Positive when dragging up
    const viewportHeight = window.innerHeight
    const deltaPercent = (deltaY / viewportHeight) * 100

    // Calculate new height
    const newHeight = dragStartHeight + deltaPercent

    // Clamp between 10 and 100
    const clampedHeight = Math.max(10, Math.min(100, newHeight))

    // Update to nearest valid state
    if (clampedHeight < 62) {
      setDrawerHeight(35)
    } else {
      setDrawerHeight(80)
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    // Snap logic is already handled in handleTouchMove
  }

  const handleSuggestionClick = (suggestionText: string) => {
    handleSend(suggestionText)
  }

  const handleRestaurantSuggestionClick = (suggestionText: string, slug: string) => {
    // Add user message and trigger chat
    handleSuggestionClick(suggestionText)
  }

  const handleSend = async (textOverride?: string | React.MouseEvent | unknown) => {
    const userMessage = typeof textOverride === 'string' ? textOverride : input.trim()

    if (!userMessage || isLoading) return

    // Check if query conflicts with active isochrone
    if (isochroneRegionSlugs && isochroneRegionSlugs.length > 0) {
      const breakoutPhrases = [
        'across all of nyc',
        'across nyc',
        'all of nyc',
        'everywhere in nyc',
        'citywide',
        'all restaurants',
        'throughout nyc',
        'anywhere in nyc'
      ];

      const lowerMessage = userMessage.toLowerCase();
      const hasBreakoutIntent = breakoutPhrases.some(phrase =>
        lowerMessage.includes(phrase)
      );

      if (hasBreakoutIntent) {
        // Show confirmation dialog
        setPendingQuery(userMessage);
        setShowResetConfirmation(true);
        setInput(''); // Clear input
        return; // Don't send yet
      }
    }

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    // Add user message to conversation history
    const userHistoryMessage: GeminiMessage = {
      role: 'user',
      parts: [{ text: userMessage }]
    }

    // Keep only last 10 messages (20 entries = 10 back-and-forth exchanges)
    const trimmedHistory = conversationHistory.slice(-20)
    const historyWithUserMessage = [...trimmedHistory, userHistoryMessage]

    try {
      console.log('Sending chat message:', userMessage)
      console.log('Conversation history length:', historyWithUserMessage.length)

      const response = await sendChatMessage(userMessage, {
        totalRestaurants: allRestaurants.length,
        visibleRestaurants: restaurants.length,
        activeFilters: {},
        // Pass visible restaurants from previous turn for state persistence
        visible_restaurants: lastVisibleRestaurants,
        // Pass isochrone params from previous turn for state persistence
        isochrone_params: lastIsochroneParams
      }, historyWithUserMessage)
      console.log('Chat response:', response)

      console.log('Chat response:', response)

      // NEW: Handle Backend Agent Response (LangGraph)
      if (response.visible_restaurants || response.response) {
        const agentMessage = response.response || response.message || "Here are the results.";

        // Store visible restaurants for next turn (state persistence)
        if (response.visible_restaurants && Array.isArray(response.visible_restaurants)) {
          setLastVisibleRestaurants(response.visible_restaurants);
          console.log(`💾 Stored ${response.visible_restaurants.length} restaurants for next query`);
        }

        // Store isochrone params for next turn (state persistence)
        if (response.isochrone_params) {
          setLastIsochroneParams(response.isochrone_params);
          console.log(`💾 Stored isochrone params for next query:`, response.isochrone_params);

          // Trigger map filtering for multi-party isochrones
          // This hides restaurants outside the polygon boundaries
          if (response.isochrone_params.allRestaurantSlugs &&
            response.isochrone_params.allRestaurantSlugs.length > 0) {
            onIsochroneRegion?.(response.isochrone_params.allRestaurantSlugs);
            console.log(`🗺️ Applied multi-party isochrone filtering: ${response.isochrone_params.allRestaurantSlugs.length} restaurants`);
          }
        }

        // 1. Execute Map Actions from Agent (New Visual Tools)
        if (response.map_actions && response.map_actions.length > 0) {
          const mapActions = response.map_actions
          console.log(`🗺️ Executing ${mapActions.length} map actions from agent`)

          mapActions.forEach((action: any) => {
            switch (action.mapAction) {
              case 'showIsochrone':
                if (onIsochroneUpdate && action.polygon) {
                  console.log("📍 Show isochrone on map:", action.polygon);
                  onIsochroneUpdate(action.polygon);

                  // NEW: Set isochrone region (all restaurants in polygon)
                  if (onIsochroneRegion && action.allRestaurantSlugs) {
                    console.log(`📍 Setting isochrone region: ${action.allRestaurantSlugs.length} restaurants`);
                    onIsochroneRegion(action.allRestaurantSlugs);
                  }
                }
                break;

              case 'showIsochroneLayer':
                // Multi-layer isochrones (for meeting points)
                if (onIsochroneLayersUpdate && action.polygon) {
                  console.log(`📍 Show isochrone layer: ${action.label} (${action.color})`);
                  // Collect all layers and update at once (only on first occurrence)
                  if (!mapActions.find((a: any, i: number) =>
                    a.mapAction === 'showIsochroneLayer' &&
                    mapActions.indexOf(action) > i
                  )) {
                    const colorMap: Record<string, { fill: string, stroke: string, opacity: number }> = {
                      'pink': { fill: '#FF1493', stroke: '#FF69B4', opacity: 0.2 },
                      'blue': { fill: '#1E90FF', stroke: '#4169E1', opacity: 0.2 },
                      'purple': { fill: '#8B008B', stroke: '#9932CC', opacity: 0.0 }
                    };

                    const layers = mapActions
                      .filter((a: any) => a.mapAction === 'showIsochroneLayer')
                      .map((a: any) => {
                        const colors = colorMap[a.color] || colorMap['purple'];
                        return {
                          id: a.layerId,
                          polygon: a.polygon,
                          label: a.label,
                          color: colors.fill,
                          strokeColor: colors.stroke,
                          opacity: colors.opacity,
                          metadata: {
                            location: a.label
                          }
                        };
                      });
                    console.log(`📍 Updating isochrone layers:`, layers);
                    onIsochroneLayersUpdate(layers);
                  }
                }
                break;

              case 'highlightRestaurants':
                if (action.slugs && action.slugs.length > 0) {
                  // NEW: Check if this is "all restaurants" (no actual filtering)
                  const isochroneAction = response.map_actions?.find(
                    (a: any) => a.mapAction === 'showIsochrone'
                  );

                  const isFullRegion = isochroneAction?.allRestaurantSlugs &&
                    action.slugs.length === isochroneAction.allRestaurantSlugs.length;

                  if (isFullRegion) {
                    console.log(`📍 No filtering - showing all ${action.slugs.length} restaurants as grey`);
                    onFilterChange('Semantic Search Results', []);  // Clear highlights → grey
                  } else {
                    console.log(`📍 Filtering active - highlighting ${action.slugs.length} restaurants`);
                    onFilterChange('Semantic Search Results', action.slugs);  // Highlight pink
                  }
                }
                break;

              case 'fitBounds':
                // Fit map to show all polygons (for meeting points)
                if (onMapFocus && action.polygons) {
                  console.log(`📍 Fitting map bounds to ${action.polygons.length} polygons`);
                  // Extract all restaurant slugs from visible results
                  if (response.visible_restaurants && response.visible_restaurants.length > 0) {
                    const slugs = response.visible_restaurants.map((r: any) => r.slug);
                    onMapFocus(slugs);
                  }
                }
                break;

              case 'focusView':
                if (onMapFocus && action.target) {
                  if (action.target.type === 'slugs') {
                    console.log(`📍 Focusing map on ${action.target.slugs.length} restaurants`);
                    onMapFocus(action.target.slugs);
                  } else if (action.target.type === 'coordinates') {
                    console.log(`📍 Focusing map on coordinates: [${action.target.lng}, ${action.target.lat}]`);
                    // TODO: Add coordinate-based focus (need new callback)
                  }
                }
                break;
            }
          });
        }

        // Check if any map action is a reset (from reset_search tool)
        if (response.map_actions && response.map_actions.some((a: any) => a.mapAction === 'reset_all')) {
          console.log('🧹 Agent requested full reset via map action')
          handleClearHistory()
          return // Stop processing
        }

        // 2. FALLBACK: Legacy behavior if no map actions (backward compatibility)
        if (!response.map_actions || response.map_actions.length === 0) {
          // Handle Isochrone Updates
          if (response.isochrone_data && onIsochroneUpdate) {
            console.log("📍 Updating isochrone from agent (legacy):", response.isochrone_data);
            onIsochroneUpdate(response.isochrone_data.polygon);

            // CRITICAL: Set isochrone region to filter visible restaurants
            if (response.visible_restaurants && response.visible_restaurants.length > 0 && onIsochroneRegion) {
              const slugs = response.visible_restaurants.map((r: any) => r.slug);
              console.log(`📍 Setting isochrone region with ${slugs.length} restaurants from backend`);
              onIsochroneRegion(slugs);
            }
          }

          // Handle Visible Restaurants (Pink Markers)
          if (response.visible_restaurants && response.visible_restaurants.length > 0) {
            console.log(`📍 Updating map with ${response.visible_restaurants.length} restaurants from agent (legacy)`);
            const slugs = response.visible_restaurants.map((r: any) => r.slug);

            // Only call onFilterChange if NOT an isochrone query
            // (isochrone queries already set the region above)
            if (!response.isochrone_data) {
              onFilterChange('Semantic Search Results', slugs);
            }

            // Map focusing removed - tools should explicitly control map behavior via map_actions
            // Legacy auto-focus caused unwanted map movement for read-only tools like get_current_results
          } else if (response.visible_restaurants && response.visible_restaurants.length === 0) {
            // If agent explicitly returned empty list (and we aren't just chatting)
            if (response.tool_calls && (response.tool_calls.includes('filter_restaurants') || response.tool_calls.includes('semantic_search'))) {
              onFilterChange('Semantic Search Results', []);
            }
          }
        }

        // 3. Add Assistant Message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: agentMessage
        }]);

        // Add to history
        setConversationHistory([...historyWithUserMessage, {
          role: 'model',
          parts: [{ text: agentMessage }]
        }]);

        return; // Stop processing legacy logic
      }

      // Handle function calls first (Legacy / Direct Gemini)
      if (response.type === 'function_call' && response.function) {
        // Add model's function call to history
        const modelFunctionCall: GeminiMessage = {
          role: 'model',
          parts: [{
            functionCall: {
              name: response.function.name,
              args: response.function.arguments
            }
          }]
        }

        await handleFunctionCall(response.function)

        // Generate a helpful message based on the function call
        // Skip generic message for tools that add their own custom messages in handleFunctionCall
        const toolsWithCustomMessages = ['find_restaurants_by_travel_time', 'geocode', 'calculate_midpoint', 'find_multi_party_restaurants']
        const skipGenericMessage = toolsWithCustomMessages.includes(response.function.name)

        let helpfulMessage = response.message
        if (!skipGenericMessage && helpfulMessage === 'Processing your request...') {
          // Generate a better message based on the filters applied
          const args = response.function.arguments
          const parts = []

          // Handle semantic search message
          if (response.function.name === 'semantic_search') {
            helpfulMessage = `Found some great spots for "${args.query}"! Check out the ranked results on the map.`
          } else {
            // Handle filter_map message
            if (args.cuisines && args.cuisines.length > 0) {
              parts.push(args.cuisines.join(', '))
            }
            if (args.price_levels && args.price_levels.length > 0) {
              parts.push(args.price_levels.join(', '))
            }
            if (args.neighborhoods && args.neighborhoods.length > 0) {
              parts.push(`in ${args.neighborhoods.join(', ')}`)
            }

            if (parts.length > 0) {
              helpfulMessage = `I've filtered the map to show ${parts.join(' ')} restaurants. Check out the pins on the map!`
            }
          }
        }

        // Add function response to history
        const functionResponse: GeminiMessage = {
          role: 'function',
          parts: [{
            functionResponse: {
              name: response.function.name,
              response: {
                success: true,
                message: helpfulMessage
              }
            }
          }]
        }

        // Update conversation history with all three messages
        setConversationHistory([...historyWithUserMessage, modelFunctionCall, functionResponse])

        // Check if this was a reset_search tool call
        if (response.function.name === 'reset_search') {
          console.log('🧹 Agent triggered reset - clearing session')
          handleClearHistory()
          return // Stop processing
        }

        // Only add generic message if the tool doesn't add its own
        if (!skipGenericMessage) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: helpfulMessage || ''
          }])
        }
      } else if (response.type === 'function_calls' && response.functions) {
        // DEPRECATED: Old multi-function sequential handler
        // This code path should not be triggered anymore since multi-party queries
        // now use the single find_multi_party_restaurants tool.
        // Keeping for backward compatibility with older conversation history.
        console.warn('⚠️ DEPRECATED: Multi-function sequential handler triggered. This should not happen with new queries.')
        console.log(`🔷 Executing ${response.functions.length} function calls sequentially (legacy mode)`)

        // Execute all functions sequentially
        for (const func of response.functions) {
          console.log(`⚡ Executing function: ${func.name}`)
          await handleFunctionCall(func)
        }

        // Build conversation history with all function calls and responses
        const modelFunctionCalls: GeminiMessage = {
          role: 'model',
          parts: response.functions.map(f => ({
            functionCall: {
              name: f.name,
              args: f.arguments
            }
          }))
        }

        const functionResponses: GeminiMessage = {
          role: 'function',
          parts: response.functions.map(f => ({
            functionResponse: {
              name: f.name,
              response: {
                success: true,
                message: 'Executed successfully'
              }
            }
          }))
        }

        setConversationHistory([...historyWithUserMessage, modelFunctionCalls, functionResponses])

      } else {
        // Regular text response
        const modelTextResponse: GeminiMessage = {
          role: 'model',
          parts: [{ text: response.message }]
        }

        // Update conversation history
        setConversationHistory([...historyWithUserMessage, modelTextResponse])

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.message || ''
        }])
      }

    } catch (error) {
      console.error('Chat error details:', error)
      console.error('Error message:', error instanceof Error ? error.message : String(error))
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirmReset = async () => {
    setShowResetConfirmation(false);

    if (pendingQuery) {
      // Clear isochrone and filters first
      await handleClearHistory();

      // Then send the query after a short delay to ensure state is cleared
      setTimeout(() => {
        handleSend(pendingQuery);
        setPendingQuery(null);
      }, 100);
    }
  };

  const handleCancelReset = () => {
    setShowResetConfirmation(false);
    setPendingQuery(null);
  };

  const handleFunctionCall = async (func: { name: string, arguments: any }) => {
    console.log('Function call:', func)

    try {
      switch (func.name) {
        case 'filter_map': {
          // NEW APPROACH: Calculate matching restaurants and highlight them (instead of filtering)
          // IMPORTANT: If isochrone is active, start with isochrone base (not previous filter results)
          let matchingRestaurants = isochroneRegionSlugs
            ? allRestaurants.filter(r => isochroneRegionSlugs.includes(r.slug))
            : allRestaurants

          // Apply cuisine filter
          if (func.arguments.cuisines && func.arguments.cuisines.length > 0) {
            matchingRestaurants = matchingRestaurants.filter(r =>
              r.cuisine && func.arguments.cuisines.some((c: string) =>
                r.cuisine.toLowerCase().includes(c.toLowerCase())
              )
            )
          }

          // Apply price filter
          if (func.arguments.price_levels && func.arguments.price_levels.length > 0) {
            matchingRestaurants = matchingRestaurants.filter(r => {
              const restaurantPrice = (r as any).price ?? r.price_range
              return func.arguments.price_levels.includes(restaurantPrice)
            })
          }

          // Apply vibes/collections filter
          if (func.arguments.vibes && func.arguments.vibes.length > 0) {
            matchingRestaurants = matchingRestaurants.filter(r =>
              r.collections && func.arguments.vibes.some((vibe: string) =>
                r.collections.includes(vibe)
              )
            )
          }

          // Apply rating filter
          if (func.arguments.min_rating) {
            const minRating = parseFloat(func.arguments.min_rating)
            matchingRestaurants = matchingRestaurants.filter(r =>
              typeof (r as any).yelp_rating === 'number' && (r as any).yelp_rating >= minRating
            )
          }

          // Apply awards/badges filter
          if (func.arguments.awards && func.arguments.awards.length > 0) {
            const beforeAwardsCount = matchingRestaurants.length
            console.log(`🏆 Awards filter requested: ${JSON.stringify(func.arguments.awards)}`)

            // Debug: Show what awards exist in current results
            const awardsInResults = matchingRestaurants.filter(r => r.michelin_award || r.nyttop100_rank)
            console.log(`   Restaurants with any awards in pool: ${awardsInResults.length}`)
            if (awardsInResults.length > 0) {
              console.log(`   Sample:`, awardsInResults.slice(0, 5).map(r => ({
                name: r.name,
                michelin_award: r.michelin_award,
                nyttop100_rank: r.nyttop100_rank
              })))
            }

            matchingRestaurants = matchingRestaurants.filter(r => {
              return func.arguments.awards.some((badge: string) => {
                switch (badge) {
                  case 'michelin':
                    return r.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(r.michelin_award)
                  case 'bib':
                  case 'bib_goumand':
                  case 'bib_gourmand':
                    return r.michelin_award === 'BIB_GOURMAND'
                  case 'nyt':
                  case 'nyt_top_100':
                    return Boolean(r.nyttop100_rank)
                  default:
                    console.log(`   ⚠️ Unknown badge type: "${badge}"`)
                    return false
                }
              })
            })
            console.log(`🏆 Awards filter result: ${beforeAwardsCount} → ${matchingRestaurants.length}`)
          }

          // Apply neighborhood filter
          if (func.arguments.neighborhoods && func.arguments.neighborhoods.length > 0) {
            const expand = func.arguments.expand_neighborhoods || false
            let neighborhoodsToSearch = func.arguments.neighborhoods

            // If "around" or "nearby" query, expand to adjacent neighborhoods
            if (expand) {
              neighborhoodsToSearch = func.arguments.neighborhoods.flatMap((n: string) =>
                expandNeighborhoodSearch(n)
              )
              console.log(`Expanded neighborhoods:`, neighborhoodsToSearch)
            }

            matchingRestaurants = matchingRestaurants.filter(r =>
              r.neighborhood && neighborhoodsToSearch.some((n: string) =>
                r.neighborhood.toLowerCase().includes(n.toLowerCase())
              )
            )

            // Only animate/zoom when no isochrone is active
            // When isochrone is active, map stays still - only highlights change
            if (!isochroneRegionSlugs && onMapFocus && matchingRestaurants.length > 0) {
              onMapFocus(matchingRestaurants.map(r => r.slug))
            }
          }

          // Apply semantic features filter
          if (func.arguments.semantic_features && func.arguments.semantic_features.length > 0) {
            matchingRestaurants = matchingRestaurants.filter(r => {
              const highlights = r.yelp_review_highlights?.toLowerCase() || ''
              return highlights && func.arguments.semantic_features.some((keyword: string) =>
                keyword && highlights.includes(keyword.toLowerCase())
              )
            })
          }

          // HIGHLIGHT the matching restaurants (instead of filtering)
          const matchingSlugs = matchingRestaurants.map(r => r.slug)
          onFilterChange('Semantic Search Results', matchingSlugs)

          // NO map movement for filter_map (user controls view)
          console.log(`✨ Highlighting ${matchingSlugs.length} restaurants out of ${allRestaurants.length} total`)

          // GENERATE SUMMARY OUTPUT using shared formatter
          const metadata = computeResultMetadata(matchingRestaurants)
          const contextMessage = `I found ${metadata.total_count} restaurant${metadata.total_count === 1 ? '' : 's'}.`

          const summary = formatResultsSummary(matchingRestaurants, contextMessage, {
            closingMessage: "Want to learn more about any of these? Tap on a restaurant or ask me questions!"
          })

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: summary
          }])

          break
        }

        case 'show_dish_recommendations': {
          // Find and select restaurant
          const restaurant = allRestaurants.find(
            r => r.slug === func.arguments.restaurant_slug
          )
          if (restaurant) {
            onRestaurantSelect(restaurant)
            if (onMapFocus) {
              onMapFocus([restaurant.slug])
            }
          }
          break
        }

        case 'calculate_midpoint': {
          // Calculate true geographic midpoint between two locations
          const { location1, location2, cuisines, price_levels, radiusMiles } = func.arguments

          // Get coordinates for both locations
          const coords1 = getNeighborhoodCenter(location1, allRestaurants)
          const coords2 = getNeighborhoodCenter(location2, allRestaurants)

          if (!coords1 || !coords2) {
            console.error(`Could not find coordinates for ${location1} or ${location2}`)
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find the locations "${location1}" or "${location2}". Could you try different neighborhood names?`
            }])
            break
          }

          // Calculate true midpoint and find restaurants
          // Default radius: 1 mile for better coverage
          const radius = radiusMiles || 1.0
          const { midpoint, restaurants: midpointRestaurants } = calculateTrueMidpoint(
            coords1,
            coords2,
            allRestaurants,
            radius
          )

          console.log(`Midpoint between ${location1} and ${location2}:`, midpoint)
          console.log(`I found ${midpointRestaurants.length} restaurants within ${radius} miles of midpoint`)

          // Apply additional filters
          let filtered = midpointRestaurants

          if (cuisines && cuisines.length > 0) {
            filtered = filtered.filter(r =>
              r.cuisine && cuisines.some((c: string) => r.cuisine.toLowerCase().includes(c.toLowerCase()))
            )
            onFilterChange('Cuisine', cuisines)
          }

          if (price_levels && price_levels.length > 0) {
            onFilterChange('Price', price_levels)
          }

          if (filtered.length === 0) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I found the midpoint, but no restaurants match your criteria within ${radius} miles. Try expanding your search radius or removing some filters.`
            }])
          } else {
            // Focus map on results
            if (onMapFocus) {
              onMapFocus(filtered.slice(0, 20).map(r => r.slug))
            }
          }
          break
        }

        case 'semantic_search': {
          // Extract use_current_results (default: true)
          const { use_current_results = true, ...searchArgs } = func.arguments

          // Get restaurant IDs: use isochrone region if active, otherwise full restaurant set
          const restaurant_ids = use_current_results
            ? (isochroneRegionSlugs && isochroneRegionSlugs.length > 0 ? isochroneRegionSlugs : allRestaurants.map(r => r.slug))
            : null

          console.log('Semantic search restaurant_ids:', {
            isochroneActive: isochroneRegionSlugs && isochroneRegionSlugs.length > 0,
            isochroneCount: isochroneRegionSlugs?.length || 0,
            restaurantsCount: restaurants.length,
            finalCount: restaurant_ids?.length || 'all'
          })

          // Call the semantic search API
          await handleSemanticSearch({
            ...searchArgs,
            restaurant_ids
          })
          break
        }

        case 'rag_search': {
          // Extract use_current_results (default: true)
          const { use_current_results = true, ...ragArgs } = func.arguments

          // Get restaurant IDs: use isochrone region if active, otherwise full restaurant set
          const restaurant_ids = use_current_results
            ? (isochroneRegionSlugs && isochroneRegionSlugs.length > 0 ? isochroneRegionSlugs : allRestaurants.map(r => r.slug))
            : null

          console.log('RAG search restaurant_ids:', {
            isochroneActive: isochroneRegionSlugs && isochroneRegionSlugs.length > 0,
            isochroneCount: isochroneRegionSlugs?.length || 0,
            restaurantsCount: restaurants.length,
            finalCount: restaurant_ids?.length || 'all'
          })

          // Call the RAG search API
          await handleRagSearch({
            ...ragArgs,
            restaurant_ids
          })
          break
        }

        case 'get_current_results': {
          const { include_examples = true } = func.arguments

          const metadata = computeResultMetadata(restaurants)
          const contextMessage = `I found ${metadata.total_count} restaurant${metadata.total_count === 1 ? '' : 's'} for you.`

          const summary = formatResultsSummary(restaurants, contextMessage, {
            includeExamples: include_examples
          })

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: summary
          }])
          break
        }

        case 'get_restaurant_vibe': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          const vibeText = restaurant.yelp_review_highlights || 'No vibe information available for this restaurant.'
          const response = `**${restaurant.name}** vibe:\n\n${vibeText}`

          // Focus map on this restaurant
          if (onMapFocus) {
            onMapFocus([restaurant.slug])
          }

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response
          }])
          break
        }

        case 'get_restaurant_price_info': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          let response = `**${restaurant.name}** pricing & info:\n\n`
          response += `💰 **Price**: ${restaurant.price || 'Not specified'}\n`
          response += `📍 **Neighborhood**: ${restaurant.neighborhood || 'Not specified'}\n`
          if (restaurant.address) response += `📮 **Address**: ${restaurant.address}\n`
          if (restaurant.telephone) response += `📞 **Phone**: ${restaurant.telephone}\n`

          // Focus map on this restaurant
          if (onMapFocus) {
            onMapFocus([restaurant.slug])
          }

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response
          }])
          break
        }

        case 'get_restaurant_reviews': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          let response = ''

          if (restaurant.yelp_review_highlights) {
            // Add line breaks for better readability
            let formatted = restaurant.yelp_review_highlights
              .replace(/\. Additionally,/g, '.\n\nAdditionally,')
              .replace(/\. (\d+\.?\d*% of)/g, '.\n\n$1')
            response += formatted
          }

          if (restaurant.reddit) {
            response += `\n\n${restaurant.reddit}`
          } else if (!restaurant.yelp_review_highlights) {
            response = `No reviews available for this restaurant.`
          }

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response
          }])
          break
        }

        case 'get_restaurant_reddit': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          const response = restaurant.reddit || `No Reddit mentions available for this restaurant.`

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response
          }])
          break
        }

        case 'get_restaurant_yelp_review': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          let response = ''

          if (restaurant.yelp_review_highlights) {
            // Add line breaks for better readability
            let formatted = restaurant.yelp_review_highlights
              .replace(/\. Additionally,/g, '.\n\nAdditionally,')
              .replace(/\. (\d+\.?\d*% of)/g, '.\n\n$1')
            response = formatted
          } else {
            response = `No Yelp review highlights available for this restaurant.`
          }

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response
          }])
          break
        }

        case 'get_restaurant_summary': {
          const restaurant = allRestaurants.find(r => r.slug === func.arguments.restaurant_slug)

          if (!restaurant) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `I couldn't find that restaurant. Could you try another name?`
            }])
            break
          }

          // Focus map on this restaurant
          if (onMapFocus) {
            onMapFocus([restaurant.slug])
          }

          // Show restaurant card instead of text summary
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            type: 'restaurant_card',
            restaurant
          }])
          break
        }

        case 'geocode_address': {
          try {
            const response = await fetch(`${API_CONFIG.API_URL}/geocode`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: func.arguments.address })
            })

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.message || 'Geocoding failed')
            }

            const data = await response.json()

            if (data.coordinates) {
              const [lon, lat] = data.coordinates

              // Find restaurants near this location (within ~0.5 miles)
              const nearbyRestaurants = allRestaurants.filter(r => {
                if (!r.latitude || !r.longitude) return false
                const distance = Math.sqrt(
                  Math.pow((r.longitude - lon) * 69, 2) +
                  Math.pow((r.latitude - lat) * 69, 2)
                )
                return distance <= 0.5 // ~0.5 miles radius
              })

              // Focus map on geocoded location
              // Only animate/zoom when no isochrone is active - otherwise map stays still
              if (!isochroneRegionSlugs && onMapFocus && nearbyRestaurants.length > 0) {
                onMapFocus(nearbyRestaurants.slice(0, 20).map(r => r.slug))
              }

              // Automatically call get_current_results to show restaurant summary
              // instead of showing coordinates
              if (nearbyRestaurants.length > 0) {
                // Compute metadata for nearby restaurants
                const metadata = computeResultMetadata(nearbyRestaurants)

                // Get top 3 examples
                const sorted = nearbyRestaurants.slice().sort((a, b) => (b.yelp_rating || 0) - (a.yelp_rating || 0))
                const examples = sorted.slice(0, 3).map(r => r.name)

                // Format summary
                let summaryParts: string[] = []
                summaryParts.push(`I found ${metadata.total_count} restaurant${metadata.total_count === 1 ? '' : 's'} near ${data.formatted_address}`)

                if (metadata.top_cuisines && metadata.top_cuisines.length > 0) {
                  const cuisineDetails = metadata.top_cuisines
                    .map((cuisine: string) => `${cuisine} (${metadata.cuisine_breakdown[cuisine]})`)
                    .join(', ')
                  summaryParts.push(`Cuisines: ${cuisineDetails}`)
                }

                if (metadata.avg_rating > 0) {
                  summaryParts.push(`Average rating: ${metadata.avg_rating}⭐`)
                }

                const awards: string[] = []
                if (metadata.michelin_count > 0) {
                  awards.push(`${metadata.michelin_count} Michelin-starred`)
                }
                if (metadata.nyt_count > 0) {
                  awards.push(`${metadata.nyt_count} NYT Top 100`)
                }
                if (awards.length > 0) {
                  summaryParts.push(`Awards: ${awards.join(', ')}`)
                }

                if (examples.length > 0) {
                  summaryParts.push(`Top-rated: ${examples.join(', ')}`)
                }

                const summaryMessage = summaryParts.join('\n')

                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `${summaryMessage}\n\nTap on a restaurant for details or ask me anything!`
                }])
              } else {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `I found "${data.formatted_address}" but no restaurants nearby (within 0.5 miles). Try a different location or expand your search radius?`
                }])
              }
            } else {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Couldn't find location "${func.arguments.address}". Could you try a different address or neighborhood?`
              }])
            }
          } catch (error) {
            console.error('Geocoding error:', error)
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Sorry, I had trouble finding that location. ${error instanceof Error ? error.message : 'Please try again.'}`
            }])
          }
          break
        }

        case 'find_restaurants_by_travel_time': {
          try {
            const { location, travel_time_minutes, mode, cuisines, price_levels, min_rating, awards } = func.arguments

            // Check for Geoapify free tier limits (transit only)
            const isTransit = mode === 'transit'
            const cappedTime = isTransit && travel_time_minutes > 15 ? 15 : travel_time_minutes
            const wasLimited = isTransit && travel_time_minutes > 15

            // Show warning if request was capped
            if (wasLimited) {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Heads up! Our free transit data is capped at 15 minutes (about 6.2 miles). I'll show you what's reachable in 15 minutes by subway/bus instead of ${travel_time_minutes}. For longer travel times, try "walking" or "cycling" mode! 🚇`
              }])
            }

            // Get isochrone polygon
            const isochroneResult = await getIsochrone({
              location,
              travel_time_minutes: cappedTime,
              mode: mode || 'walking'
            })

            // Phase 3: Cache polygon for potential spatial operations
            // Use current cache size to determine ID (before state update)
            const currentCacheSize = Object.keys(polygonCache).length
            const polygonId = `person${currentCacheSize + 1}`

            // Create a synchronous reference for immediate use
            const newCacheEntry = {
              polygon: isochroneResult.polygon,
              metadata: {
                location,
                mode: mode || 'walking',
                travel_time: cappedTime
              }
            }

            setPolygonCache(prev => ({
              ...prev,
              [polygonId]: newCacheEntry
            }))
            console.log(`💾 Cached polygon as "${polygonId}" for location: ${location}`)

            // Filter restaurants by polygon
            let restaurantsInArea = filterRestaurantsByPolygon(allRestaurants, isochroneResult.polygon)
            console.log(`📍 Initial restaurants in ${cappedTime}min ${mode} radius: ${restaurantsInArea.length}`)

            // Apply additional filters if specified
            if (cuisines && cuisines.length > 0) {
              const cuisineSet = new Set(cuisines.map((c: string) => c.toLowerCase()))
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.cuisine && cuisineSet.has(r.cuisine.toLowerCase())
              )
              console.log(`🍽️  Cuisine filter [${cuisines.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (price_levels && price_levels.length > 0) {
              const priceLevelSet = new Set(price_levels)
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.price && priceLevelSet.has(r.price)
              )
              console.log(`💰 Price filter [${price_levels.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (min_rating && typeof min_rating === 'number') {
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.yelp_rating && r.yelp_rating >= min_rating
              )
              console.log(`⭐ Rating filter [>= ${min_rating}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (awards && awards.length > 0) {
              const beforeCount = restaurantsInArea.length
              console.log(`🏆 Attempting awards filter: ${JSON.stringify(awards)}`)

              // Debug: Check what awards exist in the area
              const awardsInArea = restaurantsInArea.filter(r => r.michelin_award || r.nyttop100_rank)
              console.log(`   I found ${awardsInArea.length} restaurants with any awards in area`)
              if (awardsInArea.length > 0) {
                console.log(`   Sample awards:`, awardsInArea.slice(0, 3).map(r => ({
                  name: r.name,
                  michelin_award: r.michelin_award,
                  nyttop100_rank: r.nyttop100_rank
                })))
              }

              restaurantsInArea = restaurantsInArea.filter(r => {
                // Check each award type
                if (awards.includes('michelin') && r.michelin_award &&
                  ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(r.michelin_award)) {
                  return true
                }
                if (awards.includes('bib_gourmand') && r.michelin_award === 'BIB_GOURMAND') {
                  return true
                }
                if (awards.includes('nyt_top_100') && r.nyttop100_rank) {
                  return true
                }
                return false
              })
              console.log(`🏆 Awards filter [${awards.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }


            // Set isochrone region (defines the base pool for subsequent queries)
            // This also sets highlightedRestaurantIds to all restaurants in the area
            if (onIsochroneRegion) {
              const slugsToSet = restaurantsInArea.map(r => r.slug)
              console.log(`📍 CALLING onIsochroneRegion with ${slugsToSet.length} restaurant slugs:`, slugsToSet.slice(0, 5))
              onIsochroneRegion(slugsToSet)
              console.log(`📍 Set isochrone region with ${restaurantsInArea.length} restaurants`)
            } else {
              console.warn('⚠️ onIsochroneRegion callback is not defined!')
            }


            // NOTE: We intentionally do NOT call onMapFocus here.
            // onIsochroneRegion already sets the highlighted restaurants correctly.
            // Calling onMapFocus would trigger handleFilterChange with stale state,
            // causing a race condition that overwrites the correct highlights.

            // Phase 3: Build and display isochrone layer (supports multi-party visualization)
            const colors = [
              { fill: '#FF69B4', stroke: '#FF1493' },  // Pink - person1
              { fill: '#4A90E2', stroke: '#2E5C8A' },  // Blue - person2
              { fill: '#c81224', stroke: '#c81224' },  // Green - person3
              { fill: '#E67E22', stroke: '#CA6F1E' },  // Orange - person4
              { fill: '#1ABC9C', stroke: '#17A589' }   // Teal - person5
            ]

            // For single isochrone queries, always use the first color (pink)
            const personIndex = 0
            const color = colors[personIndex]

            const isochroneLayer: IsochroneLayer = {
              id: polygonId,
              polygon: isochroneResult.polygon,
              label: location,
              color: color.fill,
              strokeColor: color.stroke,
              opacity: 0.2,
              metadata: {
                location,
                mode: mode || 'walking',
                travel_time: cappedTime
              }
            }

            // Clear multi-layer state FIRST to prevent interference
            if (onIsochroneLayersUpdate) {
              onIsochroneLayersUpdate([])
            }

            // Then update single isochrone visualization
            // Multi-isochrone visualization is handled by the function_calls handler
            if (onIsochroneUpdate) {
              onIsochroneUpdate(isochroneResult.polygon)
            }

            // Generate summary
            if (restaurantsInArea.length > 0) {
              const metadata = computeResultMetadata(restaurantsInArea)
              const modeLabel = mode === 'walking' ? 'walk' : mode === 'cycling' ? 'bike ride' : mode === 'transit' ? 'transit' : 'drive'
              const actualTime = cappedTime

              // Build spatial awareness message
              const polygonColor = "pink"
              const spatialGuidance = `We found ${metadata.total_count} restaurant${metadata.total_count === 1 ? '' : 's'} reachable within a ${actualTime}-minute ${modeLabel} from your ${location} perch, represented by the ${polygonColor} polygon on the map.`

              const contextMessage = spatialGuidance

              let summary = formatResultsSummary(restaurantsInArea, contextMessage, {
                closingMessage: "Tap on a restaurant for details or ask me anything!"
              })

              // Show fallback warning if approximate
              if (isochroneResult.fallback) {
                summary = `⚠️ Using distance-based approximation (API limit reached)\n\n${summary}`
              }

              setMessages(prev => [...prev, {
                role: 'assistant',
                content: summary
              }])
            } else {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `No restaurants found within ${travel_time_minutes} min ${mode || 'walking'} from ${location}. Try expanding your time range or changing the transport mode?`
              }])
            }
          } catch (error) {
            console.error('Isochrone search error:', error)
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Sorry, I had trouble calculating travel times from that location. ${error instanceof Error ? error.message : 'Please try again.'}`
            }])
          }
          break
        }

        case 'find_multi_party_restaurants': {
          try {
            const { locations, operation, cuisines, price_levels, min_rating, awards } = func.arguments

            console.log(`🎯 Multi-party query: ${locations.length} locations, operation: ${operation}`)

            // Color palette for individual isochrones
            const colors = [
              { fill: '#FF69B4', stroke: '#FF1493' },  // Pink - person1
              { fill: '#4A90E2', stroke: '#2E5C8A' },  // Blue - person2
              { fill: '#c81224', stroke: '#c81224' },  // Green - person3
              { fill: '#E67E22', stroke: '#CA6F1E' },  // Orange - person4
              { fill: '#1ABC9C', stroke: '#17A589' }   // Teal - person5
            ]

            // Color for result polygon
            const resultColors = {
              intersection: { fill: '#9B59B6', stroke: '#7D3C98' },  // Purple
              union: { fill: '#E74C3C', stroke: '#C0392B' },         // Red
              exclusion: { fill: '#F39C12', stroke: '#D68910' }      // Gold/Orange
            }

            // Step 1: Fetch all isochrones sequentially
            const isochroneData: { polygon: any; location: string; mode: string; travel_time: number }[] = []

            for (let i = 0; i < locations.length; i++) {
              const loc = locations[i]
              const locationName = loc.address
              const travelTime = loc.travel_time_minutes
              const mode = loc.mode || 'walking'

              console.log(`📍 Fetching isochrone ${i + 1}/${locations.length}: ${locationName} (${travelTime}min ${mode})`)

              try {
                const isochroneResult = await getIsochrone({
                  location: locationName,
                  travel_time_minutes: travelTime,
                  mode
                })

                isochroneData.push({
                  polygon: isochroneResult.polygon,
                  location: locationName,
                  mode,
                  travel_time: travelTime
                })

                console.log(`✅ Isochrone ${i + 1} fetched successfully`)
              } catch (error) {
                console.error(`❌ Failed to fetch isochrone for ${locationName}:`, error)
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `Sorry, I couldn't get travel time data for "${locationName}". ${error instanceof Error ? error.message : 'Please try a different location.'}`
                }])
                return
              }
            }

            // Step 2: Perform spatial operation
            let resultPolygon = null
            const polygons = isochroneData.map(d => d.polygon)

            console.log(`🔷 Computing ${operation} on ${polygons.length} polygons`)

            if (operation === 'intersection') {
              resultPolygon = intersectPolygons(...polygons)
            } else if (operation === 'union') {
              resultPolygon = unionPolygons(...polygons)
            } else if (operation === 'exclusion' && polygons.length >= 2) {
              // Exclusion: base polygon MINUS all excluded areas (supports multiple exclusions)
              resultPolygon = polygons[0]
              for (let i = 1; i < polygons.length; i++) {
                resultPolygon = excludePolygon(resultPolygon, polygons[i])
                if (!resultPolygon) break  // Stop if exclusion results in empty polygon
              }
            }

            // Check if operation resulted in empty polygon (no overlap)
            if (!resultPolygon) {
              const locationNames = isochroneData.map(d => d.location).join(' and ')
              const operationLabel = operation === 'intersection' ? 'overlap between' : operation === 'union' ? 'union of' : 'exclusion from'

              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `The ${operationLabel} ${locationNames} returned no results${operation === 'intersection' ? ' (no overlap found)' : ''}.

${operation === 'intersection' ? 'Would you like me to:\n• Show restaurants EITHER of you can reach (union)?\n• Increase travel time to 20 or 30 minutes?\n• Find the geographic midpoint between these locations?' : 'Try adjusting the travel times or locations.'}`
              }])
              return
            }

            // Step 3: Filter restaurants by result polygon
            let restaurantsInArea = filterRestaurantsByPolygon(allRestaurants, resultPolygon)
            console.log(`📍 Restaurants in ${operation} area: ${restaurantsInArea.length}`)

            // Debug: Also check individual polygon counts
            const countPoly1 = filterRestaurantsByPolygon(allRestaurants, polygons[0]).length
            const countPoly2 = filterRestaurantsByPolygon(allRestaurants, polygons[1]).length
            console.log(`   - ${isochroneData[0].location}: ${countPoly1} restaurants`)
            console.log(`   - ${isochroneData[1].location}: ${countPoly2} restaurants`)
            console.log(`   - ${operation} result: ${restaurantsInArea.length} restaurants`)

            // Apply additional filters
            if (cuisines && cuisines.length > 0) {
              const cuisineSet = new Set(cuisines.map((c: string) => c.toLowerCase()))
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.cuisine && cuisineSet.has(r.cuisine.toLowerCase())
              )
              console.log(`🍽️  Cuisine filter [${cuisines.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (price_levels && price_levels.length > 0) {
              const priceLevelSet = new Set(price_levels)
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.price && priceLevelSet.has(r.price)
              )
              console.log(`💰 Price filter [${price_levels.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (min_rating && typeof min_rating === 'number') {
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r =>
                r.yelp_rating && r.yelp_rating >= min_rating
              )
              console.log(`⭐ Rating filter [>= ${min_rating}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            if (awards && awards.length > 0) {
              const beforeCount = restaurantsInArea.length
              restaurantsInArea = restaurantsInArea.filter(r => {
                if (awards.includes('michelin') && r.michelin_award &&
                  ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(r.michelin_award)) {
                  return true
                }
                if (awards.includes('bib_gourmand') && r.michelin_award === 'BIB_GOURMAND') {
                  return true
                }
                if (awards.includes('nyt_top_100') && r.nyttop100_rank) {
                  return true
                }
                return false
              })
              console.log(`🏆 Awards filter [${awards.join(', ')}]: ${beforeCount} → ${restaurantsInArea.length}`)
            }

            // Step 4: Build visualization layers based on operation type
            let allLayers: IsochroneLayer[] = []

            if (operation === 'intersection' || operation === 'union') {
              // For intersection/union: Show ONLY base layers (natural overlap creates purple)
              // Base layers with previous opacity
              allLayers = isochroneData.map((data, index) => ({
                id: `person${index + 1}`,
                polygon: data.polygon,
                label: data.location,
                color: colors[index % colors.length].fill,
                strokeColor: colors[index % colors.length].stroke,
                opacity: 0.20,  // Original opacity
                metadata: {
                  location: data.location,
                  mode: data.mode,
                  travel_time: data.travel_time
                }
              }))
            } else if (operation === 'exclusion' && isochroneData.length >= 2) {
              // For exclusion: Support multiple excluded areas (up to 3)
              // Show result polygon (pink with holes) + gray dashed outlines of excluded areas

              // Build list of excluded area names for label
              const excludedNames = isochroneData.slice(1).map(d => d.location).join(', ')

              // Result layer (base MINUS all excluded areas) - pink with actual cutouts
              const resultLayer: IsochroneLayer = {
                id: 'exclusion_result',
                polygon: resultPolygon,
                label: isochroneData[0].location,
                color: colors[0].fill,  // Same pink as base area
                strokeColor: colors[0].stroke,
                opacity: 0.30,
                metadata: {
                  location: `${isochroneData[0].location} (excluding ${excludedNames})`
                }
              }

              // Don't show excluded areas at all - the cutout in the result polygon is sufficient
              const excludedLayers: IsochroneLayer[] = []

              // Show result with holes + gray outlines of all excluded areas
              allLayers = [resultLayer, ...excludedLayers]
            }

            // Step 5: Update map visualization
            if (onIsochroneLayersUpdate) {
              console.log(`📊 Updating map with ${allLayers.length} layers`)
              allLayers.forEach(layer => {
                console.log(`   Layer ${layer.id}: fill=${layer.color}, stroke=${layer.strokeColor}, opacity=${layer.opacity}`)
              })
              onIsochroneLayersUpdate(allLayers)
            }

            // Clear single isochrone state to prevent interference
            if (onIsochroneUpdate) {
              onIsochroneUpdate(null)
            }

            // Set isochrone region (defines the base pool for subsequent queries)
            // This also sets highlightedRestaurantIds to all restaurants in the area
            if (onIsochroneRegion) {
              onIsochroneRegion(restaurantsInArea.map(r => r.slug))
              console.log(`📍 Set isochrone region with ${restaurantsInArea.length} restaurants in ${operation} area`)
            }

            // NOTE: We intentionally do NOT call onMapFocus here.
            // onIsochroneRegion already sets the highlighted restaurants correctly.
            // Calling onMapFocus would trigger handleFilterChange with stale state,
            // causing a race condition that overwrites the correct highlights.

            // Step 7: Auto-generate summary
            if (restaurantsInArea.length > 0) {
              const metadata = computeResultMetadata(restaurantsInArea)

              // Context-aware opening based on operation with map guidance
              const locationNames = isochroneData.map(d => d.location).join(' and ')
              const operationDescriptions: Record<string, string> = {
                intersection: `reachable by all of you (shown in the purple overlap on the map where ${isochroneData.length} travel zones meet)`,
                union: `reachable by anyone in your group (shown by the combined coverage area on the map)`,
                exclusion: `near ${isochroneData[0].location} but avoiding ${isochroneData[1].location} (shown in pink with the exclusion zone removed)`
              }

              const contextMessage = `We found ${metadata.total_count} restaurant${metadata.total_count === 1 ? '' : 's'} ${operationDescriptions[operation]}.`

              const summary = formatResultsSummary(restaurantsInArea, contextMessage, {
                closingMessage: "Tap on a restaurant for details or ask me anything!"
              })

              setMessages(prev => [...prev, {
                role: 'assistant',
                content: summary
              }])
            } else {
              const locationNames = isochroneData.map(d => d.location).join(' and ')
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `No restaurants found in the ${operation} area for ${locationNames}. Try expanding your time range or adjusting filters?`
              }])
            }

          } catch (error) {
            console.error('Multi-party restaurant search error:', error)
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Sorry, I had trouble with that multi-location search. ${error instanceof Error ? error.message : 'Please try again.'}`
            }])
          }
          break
        }

        default:
          console.warn(`Unknown function: ${func.name}`)
      }
    } catch (error) {
      console.error('Function execution error:', error)
      throw new Error(`FUNCTION_INVOCATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleSemanticSearch = async (args: { query: string, keywords?: string[], pre_filters?: any, restaurant_ids?: string[] | null }) => {
    try {
      console.log('Calling semantic search API:', args)

      // Show confirmation message if searching within filtered results
      if (args.restaurant_ids && args.restaurant_ids.length > 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✓ Searching within ${args.restaurant_ids?.length || 0} restaurants in current area`
        }])
      }

      // Add timeout to fetch request
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      // Build request body - only include keywords if provided
      const requestBody: any = {
        query: args.query,
        pre_filters: args.pre_filters,
        restaurant_ids: args.restaurant_ids
      }

      if (args.keywords && args.keywords.length > 0) {
        requestBody.keywords = args.keywords
      }

      const response = await fetch(`${API_CONFIG.API_URL}/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        // Handle specific error cases
        if (response.status === 429) {
          throw new Error('API quota exceeded. The semantic search service is temporarily unavailable. Please try using traditional filters (cuisine, price, neighborhood) or try again later.')
        }

        throw new Error(errorData.error || `API error: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('Semantic search results:', data.results.length, 'restaurants')
      console.log('Keywords used:', data.keywords)

      // Highlight semantic search results with pink markers
      if (data.results.length > 0) {
        onFilterChange('Semantic Search Results', data.results.map((r: any) => r.slug))
      }

      // Focus map on the ranked results
      // Only animate/zoom when no isochrone is active - otherwise map stays still
      if (!isochroneRegionSlugs && onMapFocus && data.results.length > 0) {
        onMapFocus(data.results.map((r: any) => r.slug))
      }

      // Apply pre-filters to UI as well (if provided)
      if (args.pre_filters) {
        if (args.pre_filters.cuisines && args.pre_filters.cuisines.length > 0) {
          onFilterChange('Cuisine', args.pre_filters.cuisines)
        }
        if (args.pre_filters.price_levels && args.pre_filters.price_levels.length > 0) {
          onFilterChange('Price', args.pre_filters.price_levels)
        }
        if (args.pre_filters.min_rating) {
          onFilterChange('Yelp Rating', [args.pre_filters.min_rating.toString()])
        }
      }
    } catch (error) {
      console.error('Semantic search error:', error)

      let errorMessage = `Sorry, I had trouble searching for "${args.query}". `

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage += 'The request timed out. Please try again.'
        } else if (error.message.includes('quota')) {
          errorMessage = error.message // Use the full quota message
        } else {
          errorMessage += error.message
        }
      } else {
        errorMessage += 'Please try again or use traditional filters.'
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorMessage
      }])
    }
  }

  const handleRagSearch = async (args: { query: string, pre_filters?: any, top_k?: number, restaurant_ids?: string[] | null }) => {
    try {
      console.log('Calling RAG search API:', args)

      // Show confirmation message if searching within filtered results
      if (args.restaurant_ids && args.restaurant_ids.length > 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✓ Searching within ${args.restaurant_ids?.length || 0} restaurants in current area`
        }])
      }

      // Add timeout to fetch request
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch(`${API_CONFIG.API_URL}/rag-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        // Handle specific error cases
        if (response.status === 429) {
          throw new Error('API quota exceeded. The RAG search service is temporarily unavailable. Please try again later.')
        }

        throw new Error(errorData.error || `API error: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('RAG search results:', data.total_results, 'restaurants')
      console.log('Fallback info:', data.fallback)
      console.log('Overall explanation:', data.overall_explanation)

      // Highlight RAG results with pink markers
      if (data.results.length > 0) {
        onFilterChange('Semantic Search Results', data.results.map((r: any) => r.slug))
      }

      // Focus map on the top 7-8 RAG results to avoid decision fatigue
      // Only animate/zoom when no isochrone is active - otherwise map stays still
      if (!isochroneRegionSlugs && onMapFocus && data.results.length > 0) {
        const topResults = data.results.slice(0, 8) // Only show top 8 on map
        onMapFocus(topResults.map((r: any) => r.slug))
      }

      // NOTE: We DON'T apply pre-filters to the UI because:
      // 1. RAG already filtered the results server-side
      // 2. Applying filters would hide the RAG results from the map
      // 3. The map focus already shows only the relevant restaurants

      // Add overall explanation to chat if available
      if (data.overall_explanation) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.overall_explanation
        }])
      }

      // If there was a fallback, add a message to chat explaining it
      if (data.fallback) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.fallback.message
        }])
      }

    } catch (error) {
      console.error('RAG search error:', error)

      let errorMessage = `Sorry, I had trouble searching for "${args.query}". `

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage += 'The request timed out. Please try again.'
        } else if (error.message.includes('quota')) {
          errorMessage = error.message // Use the full quota message
        } else if (error.message.includes('PINECONE') || error.message.includes('not configured')) {
          errorMessage = 'The RAG search system is not fully set up yet. Please use traditional filters or try the basic semantic search.'
        } else {
          errorMessage += error.message
        }
      } else {
        errorMessage += 'Please try again or use traditional filters.'
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorMessage
      }])
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClearHistory = async () => {
    // 1. Call backend to reset agent state
    try {
      await fetch(`${API_CONFIG.API_URL}/reset`, { method: 'POST' })
      console.log('🧹 Backend agent state reset')
    } catch (e) {
      console.error('Failed to reset backend state:', e)
    }

    // 2. Clear chat state
    setConversationHistory([])
    setMessages([{
      role: 'assistant',
      content: welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
    }])
    setPolygonCache({})
    setLastVisibleRestaurants([])  // Clear state persistence
    setLastIsochroneParams(null)   // Clear isochrone state persistence

    // 3. Clear isochrone visualizations
    if (onIsochroneUpdate) {
      onIsochroneUpdate(null)
    }
    if (onIsochroneLayersUpdate) {
      onIsochroneLayersUpdate([])
    }

    // 4. Trigger full app reset (clears filters, resets map view)
    if (onResetAll) {
      onResetAll()
    }
  }

  return (
    <div className="chat-interface">
      {/* Chat panel - always visible */}
      <div
        ref={drawerRef}
        className={`chat-bubble drawer-${drawerHeight}`}
      >
        {/* Drag handle - mobile only */}
        <div
          className="drawer-handle"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="drawer-handle-bar"></div>
        </div>
        {/* Messages */}
        <div className="chat-messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-message ${msg.role}`}>
              {msg.role === 'assistant' ? (
                msg.type === 'restaurant_card' && msg.restaurant ? (
                  // Restaurant card: avatar outside the card (desktop only)
                  <div className="restaurant-card-message">
                    <div className="message-avatar-outside desktop-only">
                      <img src="/remi.png" alt="remi" />
                    </div>
                    <div className="restaurant-card-content">
                      <div className="restaurant-card-wrapper">
                        <RestaurantCard
                          restaurant={msg.restaurant}
                          isFavorited={favorites.includes(msg.restaurant.name)}
                          onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(msg.restaurant!.name) : undefined}
                        />
                      </div>
                      {/* Suggestion Buttons - Outside the card */}
                      <div className="restaurant-suggestions">
                        {msg.restaurant!.yelp_review_highlights && msg.restaurant!.yelp_review_highlights.length > 0 && (
                          <button
                            className="restaurant-suggestion-btn"
                            onClick={() => handleRestaurantSuggestionClick(`Yelp review highlights of ${msg.restaurant!.name}?`, msg.restaurant!.slug)}
                          >
                            Read Yelp Reviews
                          </button>
                        )}
                        {msg.restaurant!.reddit && msg.restaurant!.reddit.trim() !== '' && (
                          <button
                            className="restaurant-suggestion-btn"
                            onClick={() => handleRestaurantSuggestionClick(`Redditors' takes on ${msg.restaurant!.name}?`, msg.restaurant!.slug)}
                          >
                            Read Redditors' Takes
                          </button>
                        )}
                        {msg.restaurant!.opentable_id && msg.restaurant!.opentable_id.trim() !== '' && (
                          <a
                            href={`https://www.opentable.com/restaurant/profile/${msg.restaurant!.opentable_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="restaurant-suggestion-btn restaurant-suggestion-link"
                          >
                            ↗ Make a Reservation
                          </a>
                        )}
                        {msg.restaurant!.latitude && msg.restaurant!.longitude && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${msg.restaurant!.latitude},${msg.restaurant!.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="restaurant-suggestion-btn restaurant-suggestion-link"
                          >
                            ↗ Google Maps
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  // Regular text message: avatar inside bubble (desktop only)
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    <div className="message-bubble">
                      <div className="message-avatar-inside desktop-only">
                        <img src="/remi.png" alt="remi" />
                      </div>
                      <div className="message-content" dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }} />
                    </div>

                    {/* Meta-learning pills after buy-me-coffee messages */}
                    {isBuyMeCoffeeMessage(msg.content) && (
                      <div className="suggestions-container">
                        {metaLearningSuggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            className="suggestion-pill"
                            onClick={() => handleSuggestionClick(suggestion)}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="message-bubble user-bubble" dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }} />
              )}
            </div>
          ))}

          {/* Quick-start suggestions - show only after welcome message */}
          {messages.length === 1 && (
            <div className="suggestions-container">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  className="suggestion-pill"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="chat-message assistant">
              <div className="message-bubble">
                <div className="message-avatar-inside desktop-only">
                  <img src="/remi.png" alt="remi" />
                </div>
                <div className="message-content typing-content">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-container">
          {/* Favorites Heart Button - Left side */}
          <button
            onClick={onFavoritesToggle}
            className={`chat-favorites-button ${favoritesActive ? 'active' : ''}`}
            title={favoritesActive ? 'Show all restaurants' : 'Show favorites only'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={favoritesActive ? "#EB213E" : "none"} stroke="#EB213E" strokeWidth="2">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {favorites.length > 0 && (
              <span className="favorites-count">{favorites.length}</span>
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me about restaurants..."
            disabled={isLoading}
            className="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="chat-send-button"
          >
            ➤
          </button>
          <button
            onClick={handleClearHistory}
            className="chat-clear-button"
            title="Reset Chat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Confirmation Dialog for "across all NYC" queries */}
      {showResetConfirmation && (
        <div className="confirmation-overlay">
          <div className="confirmation-dialog">
            <h3>Clear Location Filter?</h3>
            <p>
              This query will search across all of NYC, which will clear your current
              location filter and all other filters. Do you want to continue?
            </p>
            <div className="confirmation-actions">
              <button onClick={handleCancelReset} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleConfirmReset} className="btn-primary">
                Clear Filters & Search
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default ChatInterface
