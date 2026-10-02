/**
 * Environment variables configuration
 * Provides type-safe access to environment variables
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local first, then .env for anything it doesn't set (dotenv never overrides).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

// Simple environment variable access with defaults
export const env = {
  // Google Gemini API configuration
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,

  // Geoapify: geocoding + isochrones (api/lib/geo.ts)
  GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY || "",

  // API server configuration
  API2_PORT: parseInt(process.env.API2_PORT || "3001", 10),
  NODE_ENV: (process.env.NODE_ENV || "development") as "development" | "production" | "test",
};

/**
 * Helper to get Google API key with fallback
 * Google SDKs accept either GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
 */
export const getGoogleApiKey = (): string => {
  const key = env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new Error(
      "❌ Missing Google API key. Set either GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY"
    );
  }
  return key;
};
