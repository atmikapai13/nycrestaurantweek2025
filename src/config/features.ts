// Feature flags for progressive rollout
export const FEATURES = {
  CHAT_ENABLED: import.meta.env.VITE_CHAT_ENABLED === 'true'
}

export const API_CONFIG = {
  API_URL: import.meta.env.VITE_API_URL || '/api'
}
