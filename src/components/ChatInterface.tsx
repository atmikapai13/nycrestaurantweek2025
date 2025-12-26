import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { sendChatMessage, type GeminiMessage } from '../services/chatService'
import type { Restaurant } from '../types/restaurant'
import { API_CONFIG } from '../config/features'
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
  onMapFocus,
  onIsochroneUpdate,
  onIsochroneLayersUpdate,
  onResetAll,
  isochroneRegionSlugs,
  onIsochroneRegion,
  favorites = [],
  onToggleFavorite,
}, ref) => {
  // Random welcome message selection
  const welcomeMessages = [
    'Welcome to NYC Eats! I\'m Remi. Unlike my cousins in the subway, I\'ve been vector-embedded with thousands of Yelp reviews and have a rather refined palate for semantic similarity. What are we looking for today? <br><br> If you\'re new here, click on one of the suggestions to see how I can help you in your culinary adventures:',
    'Welcome to NYC Eats! I\'m Remi. You\'re in New York, where the only real sin is eating somewhere forgettable. Give me a neighborhood, a mood, or a friend you\'re meeting halfway—I\'ll point you toward the right places. <br><br> If you\'re new here, click on one of the suggestions to see how I can help you in your culinary adventures:',
    'Welcome to NYC Eats! I\'m Remi, here to help you find the sort of restaurant that lingers — the way a good Barolo does. Give me a neighborhood or a mood, and I\'ll pour you a shortlist worth considering.<br><br> If you\'re new here, click on one of the suggestions to see how I can help you in your culinary adventures:'
  ]

  // Quick-start suggestions for new users
  const suggestions = [
    {
      label: "Near Me",
      prompt: ["I'm in Soho, hunting for $$ spot I can reach in under 15 mins. What's on the menu, Remi?",
        "Any good italian places by 15 min transit from 46th and 7th ave?",
        "Any places with good drinks within 15 min of West Village?",
        "Show me hole in the wall restaurants by Roosevelt Island Tramway with 4 rating or higher"
      ]
    },
    {
      label: "Between Us",
      prompt: ["My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min transit?",
        "I'm in Chelsea. Show me restaurants around the area excluding Hudson Yards, because it is a bit expensive.",
        "I'm in Greenwich village, and I can travel 15 minutes by subway. My friend is in Midtown. Find spots between us, Remi."
      ] 
    },
    {
      label: "Vibes",
      prompt:["Remi, give me couple places that are good for date night and perhaps $$.",
        "Remi, show me award-winning restaurants at $$ or $$$ price point.",
        "Remi, find me a couple restaurants that are modest and cozy.",
        "Remi, find me hole in the wall restaurants, and tell me what's your definition for it."
      ]
    }
  ]

  // Meta-learning suggestions shown after buy-me-coffee messages
  const metaLearningSuggestions = [
    "How do you work, Remi?",
    "What was the genesis of this project?"
  ]

  // Tips shown while loading
  const tips = [
    "Tap a restaurant on the map, then hit the heart to favorite it.",
    "To get curated restaurant recs, stack queries in one prompt (e.g., Italian restaurants with 4★ or higher).",
  "Click 'match your taste' in the map legend to isolate those restaurants on the map.",
    "Ask 'find me a spot between us' when meeting a friend—Remi will find restaurants in the overlap zone.",
    "Award-winning spots—Michelin, Bib Gourmand, or NYC Top 100—are marked with orange pins.",
    "Hit refresh in chat to clear the map and start over.",
    "Ask Remi about vibes and ambiance—he can search for 'cozy', 'romantic', 'lively', and more.",
    "After an isochrone is generated, refine it further by cuisine, rating, or vibes (e.g., Italian, 4.5★ or higher, lively).",
    "Remi can find restaurants you can reach by walking, transit, or driving — à la isochrones!",
    "An isochrone is a boundary on the map showing how far you can go in a set time. Remi is good at making isochrones!",
    "The current restaurant pool is limited to NYC Restaurant Week and Manhattan only. Buy me creator a coffee with a note if you want to expand the pool: buymeacoffee.com/atmikapai",
    "Click on a restaurant in the map to learn more.",
    "If you like this, buy me creator a coffee: buymeacoffee.com/atmikapai . Cheers!"
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
  const [currentTip, setCurrentTip] = useState('')
  // Store isochrone state for next turn
  const [lastIsochroneParams, setLastIsochroneParams] = useState<any>(null)
  const [lastIsochroneLayers, setLastIsochroneLayers] = useState<any[]>([])

  const lastMessageRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mobile drawer state
  const [drawerHeight, setDrawerHeight] = useState<10 | 40 | 80>(40)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartHeight, setDragStartHeight] = useState(40)
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)
  const [showResetConfirmation, setShowResetConfirmation] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  const scrollToLastMessage = () => {
    // Scroll to the TOP of the last message for better UX
    lastMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Auto-scroll for all new messages (not on page load)
  const prevMessagesLengthRef = useRef(messages.length)

  useEffect(() => {
    // Skip scroll on initial render/page load
    if (prevMessagesLengthRef.current === 0 && messages.length > 0) {
      prevMessagesLengthRef.current = messages.length
      return
    }

    // Scroll for all new messages (both user and assistant)
    if (messages.length > prevMessagesLengthRef.current) {
      // Small delay to ensure DOM is updated before scrolling
      setTimeout(() => scrollToLastMessage(), 100)
      prevMessagesLengthRef.current = messages.length
    }
  }, [messages])

  useEffect(() => {
    // Auto-focus input on mount
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // Randomly show a tip when loading starts (60% chance)
  useEffect(() => {
    if (isLoading) {
      const shouldShowTip = Math.random() < 0.6 // 60% chance to show a tip
      if (shouldShowTip) {
        const randomTip = tips[Math.floor(Math.random() * tips.length)]
        setCurrentTip(randomTip)
      } else {
        setCurrentTip('') // Don't show a tip this time
      }
    }
  }, [isLoading])

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

    // Update to nearest valid state (10%, 40%, or 80%)
    if (clampedHeight < 25) {
      setDrawerHeight(10)
    } else if (clampedHeight < 60) {
      setDrawerHeight(40)
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
      const response = await sendChatMessage(userMessage, {
        totalRestaurants: allRestaurants.length,
        visibleRestaurants: restaurants.length,
        activeFilters: {},
        // Pass isochrone state from previous turn for state persistence
        isochrone_params: lastIsochroneParams,
        isochrone_layers: lastIsochroneLayers
      }, historyWithUserMessage)

      // NEW: Handle Backend Agent Response (LangGraph)
      if (response.visible_restaurants || response.response) {
        const agentMessage = response.response || response.message || "Here are the results.";

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

        // Store isochrone layers for next turn (multi-party visualization persistence)
        if (response.isochrone_layers && Array.isArray(response.isochrone_layers)) {
          setLastIsochroneLayers(response.isochrone_layers);
          console.log(`💾 Stored ${response.isochrone_layers.length} isochrone layers for next query`);
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

                  // CRITICAL: Clear multi-layer isochrones before showing single isochrone
                  // This prevents old multi-party isochrones from staying on the map
                  if (onIsochroneLayersUpdate) {
                    console.log("🧹 Clearing multi-layer isochrones before showing single isochrone");
                    onIsochroneLayersUpdate([]);
                  }

                  onIsochroneUpdate(action.polygon);

                  // NEW: Set isochrone region (all restaurants in polygon)
                  if (onIsochroneRegion && action.allRestaurantSlugs) {
                    console.log(`📍 Setting isochrone region: ${action.allRestaurantSlugs.length} restaurants`);
                    onIsochroneRegion(action.allRestaurantSlugs);
                  }

                  // Collapse drawer on mobile to focus on map visualization
                  if (window.innerWidth <= 768) {
                    setDrawerHeight(40);
                    
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
                    // CRITICAL: Clear single isochrone before showing multi-layer isochrones
                    // This prevents old single isochrones from staying on the map
                    if (onIsochroneUpdate) {
                      console.log("🧹 Clearing single isochrone before showing multi-layer isochrones");
                      onIsochroneUpdate(null);
                    }

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

                    // Collapse drawer on mobile to focus on map visualization
                    if (window.innerWidth <= 768) {
                      setDrawerHeight(40);
                      
                    }
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
          // CRITICAL FIX: Don't use legacy path if we have ANY isochrone layers!
          // The backend sends isochrone_data[0] for compatibility, but this would clear isochrones
          const hasIsochroneLayers = response.isochrone_layers && response.isochrone_layers.length > 0;

          if (hasIsochroneLayers) {
            console.log("⚠️ Skipping legacy fallback - isochrone layers active, preserving all layers");
            // Multi-layers are already stored in state (lastIsochroneLayers), no action needed
          } else if (response.isochrone_data && onIsochroneUpdate) {
            // Only use legacy path for genuine single isochrones
            console.log("📍 Updating isochrone from agent (legacy):", response.isochrone_data);

            // Clear multi-layer isochrones before showing single isochrone (legacy path)
            if (onIsochroneLayersUpdate) {
              console.log("🧹 Clearing multi-layer isochrones before showing single isochrone (legacy)");
              onIsochroneLayersUpdate([]);
            }

            onIsochroneUpdate(response.isochrone_data.polygon);

            // CRITICAL: Set isochrone region to filter visible restaurants
            if (response.visible_restaurants && response.visible_restaurants.length > 0 && onIsochroneRegion) {
              const slugs = response.visible_restaurants.map((r: any) => r.slug);
              console.log(`📍 Setting isochrone region with ${slugs.length} restaurants from backend`);
              onIsochroneRegion(slugs);
            }

            // Collapse drawer on mobile to focus on map visualization
            if (window.innerWidth <= 768) {
              setDrawerHeight(40);
              
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

      // Regular text response fallback
      {
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

      // User-friendly error message
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('timed out')
      const isFetchError = errorMessage.includes('fetch') || errorMessage.includes('network')

      let userMessage = "Oops! We've encountered an error. Please refresh your page and try again!"

      // Keep original error for non-timeout/network errors (e.g., validation errors)
      if (!isTimeout && !isFetchError) {
        userMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: userMessage
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
    setLastIsochroneParams(null)   // Clear isochrone state persistence
    setLastIsochroneLayers([])      // Clear isochrone layers persistence

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
        <div ref={messagesContainerRef} className="chat-messages">
          {messages.map((msg, idx) => {
            // Check if this is the last message for scroll ref
            const isLastMessage = idx === messages.length - 1

            return (
            <div
              key={idx}
              className={`chat-message ${msg.role}`}
              ref={isLastMessage ? lastMessageRef : null}
            >
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
                            onClick={() => handleRestaurantSuggestionClick(`What do yelpers have to say about ${msg.restaurant!.name}?`, msg.restaurant!.slug)}
                          >
                            
                            Read <img src="/yelp_logo.png" alt="Yelp" className="suggestion-icon" />Yelp Highlights
                          </button>
                        )}
                        {msg.restaurant!.reddit && msg.restaurant!.reddit.trim() !== '' && (
                          <button
                            className="restaurant-suggestion-btn"
                            onClick={() => handleRestaurantSuggestionClick(`What do redditors have to say about ${msg.restaurant!.name}?`, msg.restaurant!.slug)}
                          >
                            
                            Read<img src="/reddit.webp" alt="Reddit" className="suggestion-icon" />Reddit Takes
                          </button>
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
                      <div className="message-avatar-mobile mobile-only">
                        <img src="/remi.png" alt="remi" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0', flex: 1 }}>
                        <div className="message-content" dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }} />

                        {/* Intro suggestions after first welcome message */}
                        {idx === 0 && (
                          <div className="intro-suggestions-wrapper">

                            <div className="suggestions-container">
                              {suggestions.map((suggestion, suggestionIdx) => (
                                <button
                                  key={suggestionIdx}
                                  className="suggestion-pill"
                                  onClick={() => {
                                    const randomPrompt = suggestion.prompt[Math.floor(Math.random() * suggestion.prompt.length)];
                                    handleSuggestionClick(randomPrompt);
                                  }}
                                >
                                  {suggestion.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Meta-learning pills after buy-me-coffee messages */}
                        {isBuyMeCoffeeMessage(msg.content) && (
                          <div className="intro-suggestions-wrapper">
                            <div className="suggestions-container suggestions-container-vertical">
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
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="message-bubble user-bubble" dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }} />
              )}
            </div>
            )
          })}

          {isLoading && (
            <div className="chat-message assistant">
              <div className="message-bubble">
                <div className="message-avatar-inside desktop-only">
                  <img src="/remi.png" alt="remi" />
                </div>
                <div className="message-avatar-mobile mobile-only">
                  <img src="/remi.png" alt="remi" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  <div className="message-content typing-content">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  {currentTip && (
                    <div className="loading-tip">
                      <span style={{ color: '#f63996', fontFamily: 'Times New Roman, serif', fontWeight: 'bold' }}>Tip:</span> {currentTip}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="chat-input-container">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Find a restaurant in NYC..."
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
