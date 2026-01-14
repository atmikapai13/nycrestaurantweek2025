/**
 * Environment variables configuration using T3 Env
 * Provides type-safe access to environment variables with validation
 * 
 * @see https://env.t3.gg/docs/core
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local FIRST, before validation
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env.local") });

export const env = createEnv({
  /**
   * Server-side environment variables
   * These are only available on the server and validated at runtime
   */
  server: {
    // Google Gemini API configuration
    GOOGLE_API_KEY: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),

    // MCP Server configuration
    MCP_SERVER_URL: z.string().url(),
    MCP_API_KEY: z.string().min(1),
    MCP_ANALYSIS_ID: z.string().min(1),

    // API server configuration
    API2_PORT: z.coerce.number().positive().default(3001),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },

  /**
   * What object holds the environment variables at runtime
   * For Node.js this is process.env
   */
  runtimeEnv: process.env,

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,

  /**
   * Custom error handler for better error messages
   */
  onValidationError: (error) => {
    console.error("❌ Invalid environment variables:");
    // T3 Env passes a ZodError, but check if flatten exists first
    if (typeof error === 'object' && error !== null && 'format' in error) {
      console.error(JSON.stringify(error.format(), null, 2));
    } else {
      console.error(error);
    }
    throw new Error("Invalid environment variables - check .env.local file");
  },

  /**
   * Prevent accidental usage in client-side code
   * This is only for server-side code (api2/)
   */
  onInvalidAccess: (variable) => {
    throw new Error(
      `❌ Attempted to access server-side environment variable "${variable}" on the client`
    );
  },
});

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

