/**
 * Step 1 of the chat pipeline: turn the user's message into a structured search
 * intent with ONE fast LLM call (structured output, temperature 0, fixed seed,
 * no thinking). Everything after this is deterministic code.
 *
 * The result is normalized (sorted, deduped, lowercased) so small wording
 * differences in the model's output collapse to the same intent, and cached per
 * warm instance so an identical prompt always maps to the identical intent.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, type LanguageModelUsage } from "ai";
import { z } from "zod";
import { getGoogleApiKey } from "../env.js";

export const MY_LOCATION = "MY_LOCATION";

export const google = createGoogleGenerativeAI({ apiKey: getGoogleApiKey() });
export const GEMINI_MODEL = "gemini-2.5-flash";
export const NO_THINKING = { google: { thinkingConfig: { thinkingBudget: 0 } } };

const PRICES = ["$", "$$", "$$$", "$$$$"] as const;
const AWARDS = ["michelin_star", "bib_gourmand", "nyt_top_100"] as const;
const MODES = ["walking", "cycling", "driving", "transit", "unspecified"] as const;
const KINDS = ["search", "lookup", "area_summary", "more", "chitchat"] as const;

export function buildIntentSchema(cuisines: string[]) {
  return z.object({
    kind: z
      .enum(KINDS)
      .describe(
        "search = find restaurants; lookup = user names specific restaurant(s); area_summary = describe the restaurants in an area; more = show more results for the previous search; chitchat = greetings/questions not asking for restaurants"
      ),
    restaurantNames: z.array(z.string()).describe("Restaurant names for kind=lookup, as written by the user. Otherwise []."),
    locations: z
      .array(z.string())
      .describe(
        `Places to search around, one entry per person/place, as written (e.g. "Times Square", "Murray Hill"). Use "${MY_LOCATION}" for "me", "my location", "near me", "where I am". [] if no location.`
      ),
    travelMode: z.enum(MODES).describe("walk→walking, bike→cycling, car/uber/taxi→driving, subway/train/bus/transit→transit. unspecified if not stated."),
    travelMinutes: z.number().int().nullable().describe("Travel time in minutes if stated, else null."),
    vibes: z
      .array(z.string())
      .describe(
        'Atmosphere, occasion, dietary needs, or specific dishes, as short lowercase phrases. e.g. ["cozy", "romantic"], ["vegan"], ["lively", "date night"], ["omakase"]. Do NOT include cuisines, prices, awards, or locations here.'
      ),
    cuisines: z.array(z.enum(cuisines as [string, ...string[]])).describe("Cuisines the user asked for, mapped to this exact list."),
    prices: z
      .array(z.enum(PRICES))
      .describe('cheap/affordable/budget → ["$","$$"]; mid-range → ["$$"]; fancy/splurge/upscale → ["$$$","$$$$"]. [] if not mentioned.'),
    awards: z.array(z.enum(AWARDS)).describe('Michelin star(s) → michelin_star; Bib Gourmand → bib_gourmand; NYT top 100 → nyt_top_100; "award-winning" → all three.'),
    restaurantWeek: z.boolean().describe('true if the user mentions restaurant week, prix fixe, or $30/$45/$60 deals.'),
  });
}

export type SearchIntent = z.infer<ReturnType<typeof buildIntentSchema>>;

const SYSTEM_PROMPT = `You convert a restaurant-search chat message (Manhattan, NYC) into structured fields. Extract only what the user said; never invent constraints.

Follow-ups: if PREVIOUS SEARCH is given and the new message refines it ("cheaper", "what about Italian instead", "make it 20 minutes", "romantic ones"), output the full updated search: keep every previous field the user did not change. If the message is a new, unrelated request, ignore the previous search. "show me more" / "more options" → kind=more with the previous fields unchanged.`;

function normalizeList<T extends string>(items: T[], lowercase = false): T[] {
  const cleaned = items.map((s) => (lowercase ? s.toLowerCase() : s).trim()).filter(Boolean) as T[];
  return [...new Set(cleaned)].sort();
}

export function normalizeIntent(intent: SearchIntent): SearchIntent {
  return {
    ...intent,
    restaurantNames: intent.restaurantNames.map((n) => n.trim()).filter(Boolean),
    locations: intent.locations.map((l) => l.trim()).filter(Boolean),
    vibes: normalizeList(intent.vibes, true),
    cuisines: normalizeList(intent.cuisines),
    prices: normalizeList(intent.prices),
    awards: normalizeList(intent.awards),
  };
}

const intentCache = new Map<string, SearchIntent>();

export interface ParsedIntent {
  intent: SearchIntent;
  usage?: LanguageModelUsage;
  cached: boolean;
}

export async function parseIntent(
  message: string,
  previousIntent: SearchIntent | null,
  cuisines: string[],
  useCache = true
): Promise<ParsedIntent> {
  const cacheKey = JSON.stringify([message.trim().toLowerCase(), previousIntent]);
  if (useCache && intentCache.has(cacheKey)) {
    return { intent: intentCache.get(cacheKey)!, cached: true };
  }

  const prompt = previousIntent
    ? `PREVIOUS SEARCH: ${JSON.stringify(previousIntent)}\n\nNEW MESSAGE: ${message}`
    : `MESSAGE: ${message}`;

  const { object, usage } = await generateObject({
    model: google(GEMINI_MODEL),
    schema: buildIntentSchema(cuisines),
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    seed: 7,
    providerOptions: NO_THINKING,
  });

  const intent = normalizeIntent(object);
  if (intentCache.size > 1000) intentCache.clear();
  intentCache.set(cacheKey, intent);
  return { intent, usage, cached: false };
}
