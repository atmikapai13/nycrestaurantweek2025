import { API_CONFIG } from "../config/features";
import type { Restaurant } from "../types/restaurant";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  totalRestaurants: number;
  visibleRestaurants: number;
  activeFilters: Record<string, unknown>;
  visible_restaurants?: Restaurant[];
  isochrone_params?: {
    location?: string;
    travel_time?: number;
    mode?: string;
    [key: string]: unknown;
  };
  isochrone_layers?: Array<{
    id: string;
    polygon: GeoJSON.Feature;
    label: string;
    [key: string]: unknown;
  }>;
}

export interface GeminiMessage {
  role: "user" | "model" | "function";
  parts: Array<{
    text?: string;
    functionCall?: {
      name: string;
      args: Record<string, unknown>;
    };
    functionResponse?: {
      name: string;
      response: Record<string, unknown>;
    };
  }>;
}

export interface ChatResponse {
  type?: "text" | "function_call" | "function_calls";
  message?: string;
  response?: string;
  function?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  functions?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  visible_restaurants?: Restaurant[];
  isochrone_data?: {
    geojson?: GeoJSON.Feature;
    [key: string]: unknown;
  };
  isochrone_params?: {
    location?: string;
    travel_time?: number;
    mode?: string;
    [key: string]: unknown;
  };
  isochrone_layers?: Array<{
    id: string;
    polygon: GeoJSON.Feature;
    label: string;
    [key: string]: unknown;
  }>;
  current_filters?: Record<string, unknown>;
  tool_calls?: string[];
  map_actions?: Array<{
    type: string;
    [key: string]: unknown;
  }>;
}

/**
 * Send chat message using new AI SDK endpoint (non-streaming for backward compatibility)
 * This maintains the same interface as the old LangGraph endpoint
 */
export async function sendChatMessage(
  message: string,
  context: ChatContext,
  conversationHistory: GeminiMessage[] = []
): Promise<ChatResponse> {
  // Use centralized API config for chat endpoint
  const apiUrl = API_CONFIG.CHAT_URL;

  console.log("API URL:", apiUrl);
  console.log("API_CONFIG:", API_CONFIG);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        context,
        conversationHistory,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response text:", errorText);
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: errorText || "Unknown error" };
      }
      throw new Error(error.error || `Chat API error: ${response.statusText}`);
    }

    const text = await response.text();
    const jsonResponse = JSON.parse(text);
    return jsonResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Oops! We've encountered an error. Please refresh your page and try again!"
      );
    }
    throw error;
  }
}

/**
 * Streaming version of chat message (optional - for future use)
 * Provides real-time updates as the AI generates the response
 */
export async function sendChatMessageStreaming(
  message: string,
  context: ChatContext,
  conversationHistory: GeminiMessage[] = [],
  callbacks: {
    onText?: (text: string) => void;
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
    onToolResult?: (toolName: string, result: unknown) => void;
    onComplete?: (fullResponse: ChatResponse) => void;
    onError?: (error: Error) => void;
  }
) {
  // Use centralized API config for chat endpoint
  const apiUrl = API_CONFIG.CHAT_URL;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        context,
        conversationHistory,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || !line.startsWith("0:")) continue;

        try {
          const jsonStr = line.substring(2);
          const data = JSON.parse(jsonStr);

          if (data.type === "text-delta" && data.textDelta) {
            fullText += data.textDelta;
            callbacks.onText?.(data.textDelta);
          } else if (data.type === "tool-call" && data.toolCall) {
            callbacks.onToolCall?.(data.toolCall.toolName, data.toolCall.args);
          } else if (data.type === "tool-result" && data.toolResult) {
            callbacks.onToolResult?.(
              data.toolResult.toolName,
              data.toolResult.result
            );
          }
        } catch (e) {
          console.warn("Failed to parse streaming line:", line);
        }
      }
    }

    // For now, callbacks.onComplete expects the full response
    // In streaming mode, we'd need to reconstruct it
    callbacks.onComplete?.({ response: fullText } as ChatResponse);
  } catch (error) {
    callbacks.onError?.(error as Error);
    throw error;
  }
}
