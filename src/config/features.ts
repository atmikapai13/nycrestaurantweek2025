// Feature flags for progressive rollout
export const FEATURES = {
  CHAT_ENABLED: import.meta.env.VITE_CHAT_ENABLED === "true",
};

// API base path (no trailing slash), always derived from the app's base so requests
// route through the router to THIS event's serverless functions, e.g. "/spring2026/api".
// Do NOT make this configurable via env — the subpath must match the deploy.
const API_BASE = `${import.meta.env.BASE_URL}api`;

export const API_CONFIG = {
  // Base API URL (without trailing slash)
  API_URL: API_BASE,

  // Chat endpoint URL (supports local dev override)
  CHAT_URL: import.meta.env.DEV
    ? "http://localhost:3001/chat"
    : `${API_BASE}/chat`,

  // Transcribe endpoint URL (for mobile voice input)
  TRANSCRIBE_URL: import.meta.env.DEV
    ? "http://localhost:3001/transcribe"
    : `${API_BASE}/transcribe`,
};
