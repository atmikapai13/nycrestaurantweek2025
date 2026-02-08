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

const transcribeHandler = async (c: any) => {
  try {
    const body = await c.req.json();
    const { audio, mimeType } = body;

    if (!audio) {
      return c.json({ error: "No audio data provided" }, 400);
    }

    console.log("🎤 Transcribe request received, mimeType:", mimeType);

    // Initialize Gemini
    const genai = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Send audio to Gemini for transcription
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType || "audio/webm",
          data: audio,
        },
      },
      "You are a speech-to-text transcriber. Output ONLY the verbatim words spoken in this audio — no commentary, no punctuation corrections, no formatting. If the audio is silent or unintelligible, return an empty string.",
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
};

// Mount routes (same pattern as chat.ts)
app.post("/transcribe", transcribeHandler);
app.post("/", transcribeHandler);
app.post("/*", transcribeHandler);

export const config = {
  runtime: "nodejs",
};

export default app;
export const GET = handle(app);
export const POST = handle(app);
