import { API_CONFIG } from '../config/features'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatContext {
  totalRestaurants: number
  visibleRestaurants: number
  activeFilters: Record<string, any>
  visible_restaurants?: any[]
  isochrone_params?: any  // Persist isochrone state across turns
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
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

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

    console.log('Response status:', response.status)
    console.log('Response ok:', response.ok)
    console.log('Response headers:', Object.fromEntries(response.headers.entries()))

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

    console.log('Parsing JSON response...')
    const text = await response.text()
    console.log('Raw text:', text)
    const jsonResponse = JSON.parse(text)
    console.log('JSON parsed successfully:', jsonResponse)
    return jsonResponse
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout - please try again')
    }
    throw error
  }
}
