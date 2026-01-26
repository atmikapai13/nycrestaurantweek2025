import { Hono } from "hono";
import { handle } from "hono/vercel";
import { cors } from "hono/cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env.js";

const app = new Hono();

// CORS configuration
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://atmikapai.github.io",
      "https://nyceats.live",
    ],
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

// Handle both /transcribe (local) and / (Vercel file-based routing)
app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { audio, mimeType } = body;

    if (!audio) {
      return c.json({ error: "No audio data provided" }, 400);
    }

    console.log("🎤 Transcribe request received, mimeType:", mimeType);

    // Initialize Gemini
    const genai = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
    const model = genai.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Send audio to Gemini for transcription
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType || "audio/webm",
          data: audio,
        },
      },
      "Transcribe this audio exactly as spoken. Return ONLY the transcribed text, nothing else. If you cannot understand the audio or it's silent, return an empty string.",
    ]);

    const transcription = result.response.text()?.trim() || "";
    console.log("🎤 Transcribed:", transcription);

    return c.json({ text: transcription });
  } catch (error) {
    console.error("❌ Transcription error:", error);
    const errorStr = error instanceof Error ? error.message : String(error);

    if (errorStr.includes("429") || errorStr.includes("quota")) {
      return c.json({ error: "Rate limit hit, try again in a moment" }, 429);
    }

    return c.json({ error: "Transcription failed: " + errorStr }, 500);
  }
});

export const config = {
  runtime: "nodejs",
};

export default app;
export const GET = handle(app);
export const POST = handle(app);
