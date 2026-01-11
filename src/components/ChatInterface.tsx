import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { flushSync } from 'react-dom'
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

interface ChatInterfaceProps {
  restaurants: Restaurant[]
  allRestaurants: Restaurant[]
  onFilterChange: (filterType: string, values: string[]) => void
  onRestaurantSelect: (restaurant: Restaurant) => void
  onMapFocus?: (restaurantIds: string[]) => void
  selectedRestaurant?: Restaurant | null
  onIsochroneUpdate?: (polygon: any, fitBounds?: boolean) => void
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
    'I\'m Remi. You\'re in New York, where the only real sin is eating somewhere forgettable. Give me a neighborhood, a mood, or a friend you\'re meeting halfway—I\'ll point you toward the right places. <br><br> Click on one of the suggestions to see how I can help you:',
    'I\'m Remi, here to help you navigate New York\'s culinary scene! Give me a neighborhood or a mood, and I\'ll recommend a shortlist worth considering.<br><br> Click on one of the suggestions to see how I can help you:',
    //'I\'m Remi! How can I help you to do? See how I can help you: <br><br> Click on one of the suggestions to see how I can help you:'
  ]

  // Quick-start suggestions for new users
  const suggestions = [
    {
      label: "Near Me",
      prompt: ["Here's an example scenario: 'I'm in Soho, hunting for spots I can reach in under 15 mins by subway. What's on the menu, Remi?'",
        "Here's an example scenario: 'Any places within a 15 min subway of West Village?'",
        "Here's an example scenario: 'Show me hole in the wall restaurants by Roosevelt Island Tramway by E61 st within 20 minute walk.'"
      ]
    },
    {
      label: "Between Us",
      prompt: ["Here's an example scenario: 'My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min transit?'",
        "Here's an example scenario: 'I'm in Chelsea. Show me restaurants around the area excluding MSG, because it's always too busy. I'm willing to walk up to 20 mins.'",
        "Here's an example scenario: 'I'm by AMC Times Square, and my friend is at One Manhattan West. We are willing to travel 15 minutes walking. Find spots between us, Remi.'"
      ] 
    },
    {
      label: "Vibes",
      prompt:["Here's an example scenario: 'Remi, give me couple places that are good for date night.'",
        "Here's an example scenario: 'Remi, show me happy hour spots in Soho. Willing to travel 10 mins by subway.'",
        "Here's an example scenario: 'Remi, find me a couple restaurants that are modest and cozy.'",
        "Here's an example scenario: 'Remi, find me hole in the wall restaurants, and tell me what's your definition for it.'"
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
    "Tap a restaurant marker and hit the heart to save it to your favorites.",
    "Click 'match your vibe' in the map legend to only see those restaurants.",
    "Award-winning spots—Michelin, Bib Gourmand, or NYC Top 100—appear as orange pins.",
    "Ask Remi about vibe and ambiance—think cozy, romantic, lively, and beyond.",
    "Ask Remi about the best ramen or happy hour in town.",
    "Once an isochrone is drawn, refine results by price, Yelp rating, or cuisine using the top filter bar.",
    "Isochrone, simply put, is a map boundary showing how far you can travel within a set time.",
    "The current restaurant pool is limited to NYC Restaurant Week within Manhattan.",
    "Click any restaurant on the map to see Yelp reviews, socials, and more.",
    "Enjoying NYC Eats? Buy my creator a coffee at buymeacoffee.com/atmikapai. Cheers."
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
  const [isResetting, setIsResetting] = useState(false)
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

  // Show a tip when loading starts (always on mobile, 60% chance on desktop)
  useEffect(() => {
    if (isLoading) {
      const isMobile = window.innerWidth <= 768
      const shouldShowTip = isMobile || Math.random() < 0.6 // Always on mobile, 60% chance on desktop
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

    // Expand drawer to 40vh on mobile to show restaurant card
    setDrawerHeight(40)
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

  const handleRestaurantSuggestionClick = (suggestionText: string) => {
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
      // Extract slugs from filtered restaurants for backend filter pool
      // If isochrone is active, intersect with isochrone region to ensure semantic search
      // operates on the correct subset (filter bar selections WITHIN isochrone bounds)
      let filterPoolSlugs = restaurants.map(r => r.slug);

      if (isochroneRegionSlugs && isochroneRegionSlugs.length > 0) {
        const isochroneSet = new Set(isochroneRegionSlugs);
        filterPoolSlugs = filterPoolSlugs.filter(slug => isochroneSet.has(slug));
        console.log(`🎯 Filter pool intersected with isochrone: ${filterPoolSlugs.length} restaurants`);
      }

      const response = await sendChatMessage(userMessage, {
        totalRestaurants: allRestaurants.length,
        visibleRestaurants: restaurants.length,
        filterPool: filterPoolSlugs,  // Send filtered restaurant slugs to backend
        // Pass isochrone state from previous turn for state persistence
        // After reset, explicitly send null (not undefined)
        isochrone_params: lastIsochroneParams || null,
        isochrone_layers: (lastIsochroneLayers && lastIsochroneLayers.length > 0)
          ? lastIsochroneLayers
          : undefined
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
                  console.log("📍 Show isochrone on map:", action.polygon, `fitBounds: ${action.fitBounds !== false}`);

                  // CRITICAL: Clear multi-layer isochrones before showing single isochrone
                  // This prevents old multi-party isochrones from staying on the map
                  if (onIsochroneLayersUpdate) {
                    console.log("🧹 Clearing multi-layer isochrones before showing single isochrone");
                    onIsochroneLayersUpdate([]);
                  }

                  // Pass both polygon and fitBounds flag to Map component
                  onIsochroneUpdate(action.polygon, action.fitBounds);

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
          console.log('🧹 Agent requested full reset via reset_search tool')

          // Clear state FIRST, then stop processing stale response
          await handleClearHistory()

          return // Stop processing - response data is now stale
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
            if (response.tool_calls && response.tool_calls.includes('semantic_search')) {
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
    setIsResetting(true) // Block UI during reset

    try {
      console.log('🧹 Starting reset...')

      // Step 1: Backend reset - MUST complete successfully
      try {
        const response = await fetch(`${API_CONFIG.API_URL}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })

        if (!response.ok) {
          throw new Error(`Backend reset failed with status ${response.status}`)
        }

        const data = await response.json()
        console.log('✅ Backend agent state reset:', data)
      } catch (error) {
        console.error('❌ Failed to reset backend state:', error)

        // Show error to user instead of silently continuing
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Sorry, I couldn\'t reset properly. Please refresh the page and try again.'
        }])

        return // STOP - don't clear frontend if backend failed
      }

      // Step 2: Clear frontend state SYNCHRONOUSLY (guaranteed atomic)
      flushSync(() => {
        setConversationHistory([])
        setMessages([{
          role: 'assistant',
          content: welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
        }])
        setLastIsochroneParams(null)   // Clear isochrone persistence
        setLastIsochroneLayers([])      // Clear multi-layer persistence
      })

      console.log('✅ Frontend chat state cleared (synchronous)')

      // Step 3: Clear isochrone visualizations (state is now committed)
      if (onIsochroneUpdate) {
        onIsochroneUpdate(null)
      }

      if (onIsochroneLayersUpdate) {
        onIsochroneLayersUpdate([])
      }

      // Step 4: Trigger full app reset (filters, map view)
      if (onResetAll) {
        onResetAll()
      }

      console.log('✅ Full reset complete')
    } finally {
      setIsResetting(false) // Re-enable UI
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
        {/* Collapsed header - shown only when drawer is at height 10 */}
        <div className="drawer-collapsed-header" onClick={() => setDrawerHeight(40)}>
          <img src="/remi_transparent.png" alt="Remi" className="drawer-collapsed-logo" />
          <span className="drawer-collapsed-text">Chat with Remi</span>
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
                          onRequestReviewHighlights={handleRestaurantSuggestionClick}
                          onExpandDrawer={() => {
                            if (window.innerWidth <= 768) {
                              setDrawerHeight(80)
                            }
                          }}
                          onClose={() => {
                            setMessages(prev => prev.filter((_, i) => i !== idx))
                          }}
                        />
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
            disabled={isLoading || isResetting}
            className="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || isResetting || !input.trim()}
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
