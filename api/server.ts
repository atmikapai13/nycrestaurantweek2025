import { serve } from "@hono/node-server";
import { Hono } from "hono";
import chat from "./chat.js";
import transcribe from "./transcribe.js";
import { env, getGoogleApiKey } from "./env.js";

const port = env.API2_PORT;

console.log(`📋 Environment check:`);
console.log(
  `   GOOGLE_API_KEY: ${env.GOOGLE_API_KEY ? "✅ Set" : "❌ Missing"}`
);
console.log(
  `   GOOGLE_GENERATIVE_AI_API_KEY: ${
    env.GOOGLE_GENERATIVE_AI_API_KEY ? "✅ Set" : "❌ Missing"
  }`
);
console.log(`   MCP_SERVER_URL: ${env.MCP_SERVER_URL}`);
console.log(`   MCP_API_KEY: ${env.MCP_API_KEY ? "✅ Set" : "❌ Missing"}`);
console.log(`   MCP_ANALYSIS_ID: ${env.MCP_ANALYSIS_ID}`);
console.log(`   API2_PORT: ${port}`);
console.log(`   NODE_ENV: ${env.NODE_ENV}`);

// Validate that at least one Google API key is set
try {
  getGoogleApiKey();
  console.log(`   ✅ Google API key validated`);
} catch (error) {
  console.error(
    `   ❌ ${
      error instanceof Error
        ? error.message
        : "Google API key validation failed"
    }`
  );
  process.exit(1);
}

// Combined server handling both /chat and /transcribe
const app = new Hono();

// Route requests to appropriate handlers
app.route("/chat", chat);
app.route("/transcribe", transcribe);

serve({
  fetch: app.fetch,
  port: Number(port),
});

console.log(`🚀 Server running on port ${port}`);
