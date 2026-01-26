// Feature flags for progressive rollout
export const FEATURES = {
  CHAT_ENABLED: import.meta.env.VITE_CHAT_ENABLED === "true",
};

export const API_CONFIG = {
  // Base API URL (without trailing slash)
  API_URL: import.meta.env.VITE_API_URL || "/api",

  // Chat endpoint URL (supports local dev override)
  CHAT_URL: import.meta.env.DEV
    ? "http://localhost:3001/chat"
    : `${import.meta.env.VITE_API_URL || "/api"}/chat`,

  // Transcribe endpoint URL (for mobile voice input)
  TRANSCRIBE_URL: import.meta.env.DEV
    ? "http://localhost:3001/transcribe"
    : `${import.meta.env.VITE_API_URL || "/api"}/transcribe`,
};
