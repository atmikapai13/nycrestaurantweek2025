import { API_CONFIG } from '../config/features'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatContext {
  totalRestaurants: number
  visibleRestaurants: number
  filterPool: string[]  // Array of restaurant slugs (filtered by filter bar)
  isochrone_params?: any  // Persist isochrone state across turns
  isochrone_layers?: any[]  // Persist multi-party isochrone layers across turns
}

export interface GeminiMessage {
  role: 'user' | 'model' | 'function'
  parts: Array<{
    text?: string
    functionCall?: {
      name: string
      args: Record<string, any>
    }
    functionResponse?: {
      name: string
      response: Record<string, any>
    }
  }>
}

export interface ChatResponse {
  type?: 'text' | 'function_call' | 'function_calls'
  message?: string
  response?: string // Backend agent uses this
  function?: {
    name: string
    arguments: Record<string, any>
  }
  functions?: Array<{
    name: string
    arguments: Record<string, any>
  }>
  // Backend Agent Data
  visible_restaurants?: any[]
  isochrone_data?: any
  isochrone_params?: any  // Isochrone state from backend
  isochrone_layers?: any[]  // Multi-party isochrone layers from backend
  current_filters?: any
  tool_calls?: string[]
  map_actions?: any[]
}

export async function sendChatMessage(
  message: string,
  context: ChatContext,
  conversationHistory: GeminiMessage[] = []
): Promise<ChatResponse> {
  const apiUrl = `${API_CONFIG.API_URL}/chat`
  console.log('API URL:', apiUrl)
  console.log('API_CONFIG:', API_CONFIG)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 65000) // 65 second timeout (5s buffer for Vercel's 60s limit)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        context,
        conversationHistory
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Error response text:', errorText)
      let error
      try {
        error = JSON.parse(errorText)
      } catch {
        error = { error: errorText || 'Unknown error' }
      }
      throw new Error(error.error || `Chat API error: ${response.statusText}`)
    }

    const text = await response.text()
    const jsonResponse = JSON.parse(text)
    return jsonResponse
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Oops! We've encountered an error. Please refresh your page and try again!")
    }
    throw error
  }
}
