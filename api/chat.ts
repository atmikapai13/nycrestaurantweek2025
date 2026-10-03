/**
 * POST /chat — Remi's conversational restaurant search.
 *
 * Three steps, replacing the old multi-step Gemini tool loop:
 *   1. parseIntent  — ONE fast LLM call turns the message into structured fields
 *   2. runSearch    — deterministic code: geocode → isochrones → filters → ranking
 *   3. narrate      — ONE short streamed LLM call describes the chosen restaurants
 *
 * Progress is streamed as the same tool parts the frontend already renders
 * (geocode / get_isoline as dynamic tools, displayRestaurants cards), plus a
 * `data-intent` part that comes back in history so follow-ups ("cheaper",
 * "show me more") can refine the previous search.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { safeParseChatRequest, type ValidatedUIMessage } from "./_schemas/chat.js";
import { RequestMetrics, METRICS_HEADER } from "./_lib/requestMetrics.js";
import { parseIntent, type SearchIntent } from "./_lib/intent.js";
import { describeSearch, runSearch, type ToolReporter } from "./_lib/searchPipeline.js";
import { cannedReply, narrate } from "./_lib/narrate.js";
import { allRestaurants, CUISINES, mentionsRestaurantWeek, toCard } from "./_lib/restaurants.js";

/** Benchmarks send `x-nyceats-cache: off` to measure uncached latency and model determinism. */
const CACHE_HEADER = "x-nyceats-cache";
/** Benchmarks send `x-nyceats-pacing: off` to measure engine speed without the stage pauses. */
const PACING_HEADER = "x-nyceats-pacing";

const RATE_LIMIT_MESSAGE =
  "My buddy, Gemini, is exhausted. He's complaining about hitting API rate limits or something. Give us ~30 seconds to catch our breath and try again!";

function isRateLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(text);
}

function messageText(message: ValidatedUIMessage | undefined): string {
  if (!message) return "";
  const fromParts = (message.parts ?? [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join(" ");
  return (fromParts || message.content || "").trim();
}

const intentOf = (message: ValidatedUIMessage): SearchIntent | null =>
  ((message.parts ?? []).find((p: any) => p.type === "data-intent") as any)?.data ?? null;

/** The intent of the most recent assistant reply, for follow-up refinement. */
/** Did the parser just copy the previous search's places and travel (the user didn't name any
    place or change how they're getting around)? */
function carriesOverArea(intent: SearchIntent, previous: SearchIntent, message: string): boolean {
  if (!previous.locations.length || intent.kind === "lookup" || intent.kind === "chitchat") return false;
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
  if (!same(intent.locations, previous.locations)) return false;
  if (intent.travelMode !== previous.travelMode || intent.travelMinutes !== previous.travelMinutes) return false;
  const text = message.toLowerCase();
  return !intent.locations.some((place) => place !== "MY_LOCATION" && text.includes(place.toLowerCase()));
}

/** Tells Remi where this follow-up searched, so he can say so (or ask) instead of guessing. */
function scopeNote(
  scope: "visible area" | "hidden area" | null,
  region: { places: string[]; restaurantCount: number } | null
): string {
  if (scope === "visible area") {
    const places = region?.places.length ? ` around ${region.places.join(" and ")}` : "";
    return `SEARCH AREA: the same travel-time area already on the map${places} (${region?.restaurantCount ?? "?"} restaurants); it wasn't redrawn. `;
  }
  if (scope === "hidden area") {
    return "SEARCH AREA: the user hid the earlier travel-time area, so this searched all of Manhattan.";
  }
  return "";
}

function previousIntent(messages: ValidatedUIMessage[]): SearchIntent | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const intent = intentOf(messages[i]);
    if (intent) return intent;
  }
  return null;
}

/** Slugs shown since the current search began (so "show me more" never repeats). */
function shownInCurrentSearch(messages: ValidatedUIMessage[]): string[] {
  const shown: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (const part of (message.parts ?? []) as any[]) {
      if (part.type === "tool-displayRestaurants") {
        shown.push(...(part.output?.restaurants ?? []).map((r: { slug: string }) => r.slug));
      }
    }
    const intent = intentOf(message);
    if (intent && intent.kind !== "more") break;
  }
  return shown;
}

const app = new Hono();
app.use("/*", cors());

// Warm-up: GET request to /api/chat warms the serverless function
app.get("/", (c) => c.text("ok"));
app.get("/*", (c) => c.text("ok"));

const chatHandler = async (c: any) => {
  const parsed = safeParseChatRequest(await c.req.json());
  if (!parsed.success) {
    console.error("❌ Invalid chat request:", JSON.stringify(parsed.error.format(), null, 2));
    return c.json({ error: "Invalid request body", details: parsed.error.format() }, 400);
  }

  const { messages, context } = parsed.data;
  const metrics = new RequestMetrics();
  const wantMetrics = c.req.header(METRICS_HEADER) === "1";
  const useCache = c.req.header(CACHE_HEADER) !== "off";

  const userMessage = messageText(messages.filter((m) => m.role === "user").pop());
  const rawPool: string[] = (context as any)?.filterPool ?? [];
  const filterPool = rawPool.length < allRestaurants.length ? rawPool : [];
  const userLocation = (context as any)?.userLocation ?? null;
  // The travel-time area shown on the map (null when none is visible or the user hid it)
  const mapRegion: { places: string[]; restaurantCount: number } | null = (context as any)?.mapRegion ?? null;

  // 1. Parse intent (before streaming, so a rate limit can still return a 429).
  let intent: SearchIntent;
  let areaScope: "visible area" | "hidden area" | null = null;
  try {
    const startMs = metrics.now();
    const previous = previousIntent(messages);
    const result = await parseIntent(userMessage, previous, CUISINES, useCache);
    metrics.recordLlmCall("parse intent", startMs, result.usage, result.cached);
    intent = result.intent;
    // A follow-up that keeps the previous places and travel unchanged doesn't redraw the area:
    // it searches what's on the map (filterPool is already limited to the visible area), or all
    // of Manhattan if the user hid it. Naming new places or changing the travel still re-runs.
    if (previous && carriesOverArea(intent, previous, userMessage)) {
      areaScope = mapRegion ? "visible area" : "hidden area";
      intent = { ...intent, locations: [], travelMode: "unspecified", travelMinutes: null };
    }
    if (mentionsRestaurantWeek(userMessage)) intent = { ...intent, restaurantWeek: true };
  } catch (error) {
    console.error("❌ Intent parsing failed:", error);
    metrics.log();
    return isRateLimit(error)
      ? c.json({ error: "RATE_LIMIT", message: RATE_LIMIT_MESSAGE }, 429)
      : c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
  console.log(`🧭 "${userMessage}" → ${intent.kind}: ${describeSearch(intent)}`);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UIMessageChunk) => {
        metrics.recordChunk(chunk.type);
        writer.write(chunk);
      };
      write({ type: "start" });
      write({ type: "data-intent", data: intent });

      let toolCount = 0;
      const metricIndex = new Map<string, number>();
      const tools: ToolReporter = {
        start(toolName, input, options) {
          const toolCallId = `${toolName}-${metrics.id}-${toolCount++}`;
          metricIndex.set(toolCallId, metrics.toolStarted(toolName, input));
          write({ type: "tool-input-available", toolCallId, toolName, input, dynamic: options?.dynamic });
          return toolCallId;
        },
        finish(toolCallId, output) {
          metrics.toolFinished(metricIndex.get(toolCallId)!, true);
          write({ type: "tool-output-available", toolCallId, output });
        },
        fail(toolCallId, errorText) {
          metrics.toolFinished(metricIndex.get(toolCallId)!, false);
          write({ type: "tool-output-error", toolCallId, errorText });
        },
        async measure(name, input, fn) {
          const index = metrics.toolStarted(name, input);
          try {
            const result = await fn();
            metrics.toolFinished(index, true);
            return result;
          } catch (error) {
            metrics.toolFinished(index, false);
            throw error;
          }
        },
      };

      // 2. Deterministic search.
      const outcome = await runSearch(intent, {
        userLocation,
        filterPool,
        previouslyShown: shownInCurrentSearch(messages),
        useCache,
        pacing: c.req.header(PACING_HEADER) !== "off",
        tools,
      });

      if (outcome.status === "ok") {
        const cards = outcome.shown.map((r) => ({ ...toCard(r), match_reason: outcome.reasons[r.slug] }));
        const id = tools.start("displayRestaurants", { restaurant_names: cards.map((r) => r.slug) });
        tools.finish(id, { restaurants: cards, count: cards.length, query: describeSearch(intent) });
        metrics.setDisplayed(cards.map((r) => r.slug));
      }

      // 3. Remi's reply.
      const canned = cannedReply(outcome);
      if (canned) {
        write({ type: "text-start", id: "reply" });
        write({ type: "text-delta", id: "reply", delta: canned });
        write({ type: "text-end", id: "reply" });
      } else {
        const startMs = metrics.now();
        const reply = narrate(userMessage, intent, outcome, scopeNote(areaScope, mapRegion));
        for await (const chunk of reply.toUIMessageStream({ sendStart: false, sendFinish: false })) write(chunk);
        metrics.recordLlmCall("narrate", startMs, await reply.usage);
      }

      write({ type: "finish", messageMetadata: wantMetrics ? { metrics: metrics.summary() } : undefined });
      metrics.log();
    },
    onError: (error) => {
      console.error("❌ Chat stream error:", error);
      metrics.log();
      return isRateLimit(error) ? `RATE_LIMIT: ${RATE_LIMIT_MESSAGE}` : "Something went wrong while searching.";
    },
  });

  return createUIMessageStreamResponse({ stream });
};

// Mount on "/chat" for local development (api/_server.ts)
app.post("/chat", chatHandler);
// Catch-all for Vercel (file-based routing passes "/" or full path)
app.post("/", chatHandler);
app.post("/*", chatHandler);

// Vercel configuration - use Node.js runtime for fs/path APIs
export const config = {
  runtime: "nodejs",
};

// Default export for local development (api/_server.ts uses this)
export default app;

// Named exports for Vercel serverless functions
export const GET = handle(app);
export const POST = handle(app);
