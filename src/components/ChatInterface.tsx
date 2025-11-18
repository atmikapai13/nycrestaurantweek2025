import { useState, useRef, useEffect } from 'react'
import { sendChatMessage, type GeminiMessage } from '../services/chatService'
import type { Restaurant } from '../types/restaurant'
import './ChatInterface.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatInterfaceProps {
  restaurants: Restaurant[]
  allRestaurants: Restaurant[]
  onFilterChange: (filterType: string, values: string[]) => void
  onRestaurantSelect: (restaurant: Restaurant) => void
  onMapFocus?: (restaurantIds: string[]) => void
  selectedRestaurant?: Restaurant | null
}

export default function ChatInterface({
  restaurants,
  allRestaurants,
  onFilterChange,
  onRestaurantSelect,
  onMapFocus,
  selectedRestaurant
}: ChatInterfaceProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Welcome! I\'m Remi, your rodent sommelier of the NYC dining scene. Yes, I\'m aware of the irony—a rat recommending restaurants. But unlike my cousins in the subway, I\'ve been vector-embedded with thousands of Yelp reviews and have a rather refined palate for semantic similarity. What are we looking for today?'
    }
  ])
  const [conversationHistory, setConversationHistory] = useState<GeminiMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastSelectedRestaurant, setLastSelectedRestaurant] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Detect when user selects a restaurant on the map
  useEffect(() => {
    if (selectedRestaurant && selectedRestaurant.name !== lastSelectedRestaurant) {
      setLastSelectedRestaurant(selectedRestaurant.name)

      // Generate a message about the selected restaurant
      const highlights = selectedRestaurant.yelp_review_highlights
      const reddit = selectedRestaurant.reddit

      let message = `Oh, you selected ${selectedRestaurant.name}! `

      if (highlights) {
        message += `Here's what Yelpers have to say: ${highlights}`
      } else {
        message += `This is a ${selectedRestaurant.cuisine} restaurant in ${selectedRestaurant.neighborhood}.`
      }

      if (reddit) {
        message += `\n\nRedditors say: ${reddit}`
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: message
      }])
    }
  }, [selectedRestaurant, lastSelectedRestaurant])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
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
        activeFilters: {}
      }, historyWithUserMessage)
      console.log('Chat response:', response)

      // Handle function calls first
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
        let helpfulMessage = response.message
        if (helpfulMessage === 'Processing your request...') {
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

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: helpfulMessage
        }])
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
          content: response.message
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

  const handleFunctionCall = async (func: { name: string, arguments: any }) => {
    console.log('Function call:', func)

    switch (func.name) {
      case 'filter_map': {
        if (func.arguments.cuisines && func.arguments.cuisines.length > 0) {
          onFilterChange('Cuisine', func.arguments.cuisines)
        }
        if (func.arguments.price_levels && func.arguments.price_levels.length > 0) {
          onFilterChange('Price', func.arguments.price_levels)
        }
        if (func.arguments.vibes && func.arguments.vibes.length > 0) {
          onFilterChange('Vibes', func.arguments.vibes)
        }
        if (func.arguments.min_rating) {
          onFilterChange('Yelp Rating', [func.arguments.min_rating.toString()])
        }
        if (func.arguments.awards && func.arguments.awards.length > 0) {
          onFilterChange('Badges', func.arguments.awards)
        }

        // Handle neighborhoods with map focus
        if (func.arguments.neighborhoods && func.arguments.neighborhoods.length > 0) {
          const matchingRestaurants = allRestaurants.filter(r =>
            func.arguments.neighborhoods.some((n: string) =>
              r.neighborhood.toLowerCase().includes(n.toLowerCase())
            )
          )
          if (onMapFocus && matchingRestaurants.length > 0) {
            onMapFocus(matchingRestaurants.map(r => r.slug))
          }
        }

        // Handle semantic features (search in yelp_review_highlights)
        if (func.arguments.semantic_features && func.arguments.semantic_features.length > 0) {
          onFilterChange('Semantic Features', func.arguments.semantic_features)
        }
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
        // Find restaurants in both neighborhoods
        const { location1, location2, cuisines, price_levels } = func.arguments

        let matchingRestaurants = allRestaurants.filter(r => {
          const inLocation1 = r.neighborhood.toLowerCase().includes(location1.toLowerCase())
          const inLocation2 = r.neighborhood.toLowerCase().includes(location2.toLowerCase())
          return inLocation1 || inLocation2
        })

        // Apply additional filters
        if (cuisines && cuisines.length > 0) {
          matchingRestaurants = matchingRestaurants.filter(r =>
            cuisines.some((c: string) => r.cuisine.toLowerCase().includes(c.toLowerCase()))
          )
          onFilterChange('Cuisine', cuisines)
        }

        if (price_levels && price_levels.length > 0) {
          onFilterChange('Price', price_levels)
        }

        if (onMapFocus && matchingRestaurants.length > 0) {
          onMapFocus(matchingRestaurants.map(r => r.slug))
        }
        break
      }

      case 'semantic_search': {
        // Call the semantic search API - must await since it's async
        await handleSemanticSearch(func.arguments)
        break
      }

      case 'rag_search': {
        // Call the RAG search API - must await since it's async
        await handleRagSearch(func.arguments)
        break
      }
    }
  }

  const handleSemanticSearch = async (args: { query: string, keywords?: string[], pre_filters?: any }) => {
    try {
      console.log('Calling semantic search API:', args)

      // Add timeout to fetch request
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      // Build request body - only include keywords if provided
      const requestBody: any = {
        query: args.query,
        pre_filters: args.pre_filters
      }

      if (args.keywords && args.keywords.length > 0) {
        requestBody.keywords = args.keywords
      }

      const response = await fetch('/api/semantic-search', {
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

      // Focus map on the ranked results
      if (onMapFocus && data.results.length > 0) {
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

  const handleRagSearch = async (args: { query: string, pre_filters?: any, top_k?: number }) => {
    try {
      console.log('Calling RAG search API:', args)

      // Add timeout to fetch request
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch('/api/rag-search', {
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

      // Focus map on the top 7-8 RAG results to avoid decision fatigue
      // RAG returns pre-filtered results, so we just focus the map without changing UI filters
      if (onMapFocus && data.results.length > 0) {
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

  const handleClearHistory = () => {
    setConversationHistory([])
    setMessages([{
      role: 'assistant',
      content: 'Hey there! I\'m Remi, your friendly neighborhood food expert 🐀👨‍🍳 What kind of dining experience are you craving today?'
    }])
  }

  return (
    <div className="chat-interface">
      {/* Remi button - always visible */}
      <button
        className={`chat-remi-button ${isOpen ? 'chat-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle chat with Remi"
      >
        <img src="/remi.png" alt="Remi" />
      </button>

      {/* Chat bubble - appears when open */}
      {isOpen && (
        <div className="chat-bubble">
          <div className="chat-header">
            <span className="chat-title">Chat with Remi</span>
            <button
              className="clear-history-button"
              onClick={handleClearHistory}
              title="Clear conversation history"
              aria-label="Clear conversation history"
            >
              ↺
            </button>
          </div>
          <div className="chat-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="message-avatar">
                    <img src="/remi.png" alt="Remi" />
                  </div>
                )}
                <div className="message-bubble">
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="message-avatar">
                    <img src="/user_bot.png" alt="You" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="chat-message assistant">
                <div className="message-avatar">
                  <img src="/remi.png" alt="Remi" />
                </div>
                <div className="message-bubble typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-container">
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
          </div>
        </div>
      )}
    </div>
  )
}
