/**
 * Step 3 of the chat pipeline: Remi's reply. Outcomes that need a fixed answer
 * (clarifications, outside Manhattan) get canned text with no LLM call; the
 * rest get one short streamed call that describes restaurants the pipeline
 * already chose — the model never picks or reorders them.
 */
import { streamText } from "ai";
import { GEMINI_MODEL, google, NO_THINKING, type SearchIntent } from "./intent.js";
import type { MatchReason } from "./matchReasons.js";
import { describeSearch, type SearchOutcome } from "./searchPipeline.js";

const OUTSIDE_MANHATTAN =
  "Alas, NYC Eats is limited to Manhattan (for now). If you'd like to add more restaurants, nudge me with a coffee [here](https://buymeacoffee.com/atmikapai).";

/** Fixed reply for outcomes that don't need the LLM, or null if narration should run. */
export function cannedReply(outcome: SearchOutcome): string | null {
  switch (outcome.status) {
    case "needs_user_location":
      return "I can't see your location yet. Allow location access in your browser (or tell me a nearby address or neighborhood) and I'll map what's around you.";
    case "outside_manhattan":
      return OUTSIDE_MANHATTAN;
    case "location_not_found":
      return `Hmm, I couldn't place "${outcome.place}" in Manhattan. Could you give me a street address, cross streets, or a neighborhood?`;
    default:
      return null;
  }
}

const PERSONA = `You are Remi, a witty restaurant concierge inspired by Ratatouille's Remy, with Anthony Bourdain's honesty. You help people find Manhattan restaurants, especially NYC Restaurant Week prix-fixe deals ($30/$45/$60 lunch, brunch, and dinner menus at 600+ restaurants).`;

const RULES = `Write the reply that accompanies the restaurants the user can already see on the map. Up to 3 short sentences in total, no lists or headings.
- Opening (ONLY if ASSUMED TRAVEL is given): lay out the assumption so the user can correct it, naming the pinned places from PLACED ON THE MAP (e.g. "Assuming a 15-minute subway ride from AMC Empire 25 and One Manhattan West."). Without ASSUMED TRAVEL there is no opening: don't confirm pins or restate travel the user specified. Never state times or distances that aren't given to you. Put a blank line (two newlines) after the opening.
- SEARCH AREA: ONLY when a SEARCH AREA line is given, begin the overview by saying where you searched, in the words it suggests. When there is no SEARCH AREA line, never say you stayed in the same area or searched all of Manhattan.
- Overview: one sentence saying how many picks you have (the number of SHOWN RESTAURANTS) and, if WHERE is given, where they are, in your own voice (e.g. "I've got 5 spots for you, most of them in Koreatown."). Use only the neighborhoods in WHERE; never invent geography.
- Put a blank line (two newlines) between the overview and the highlights.
- Highlights: one sentence calling out the first two SHOWN RESTAURANTS, in that order (they're the top-ranked picks, numbered 1 and 2 on the map; only the first if there's just one), each with a reason of about 8–14 words paraphrased from its "why" (quote first, else facts) and its cuisine, e.g. "HanGawi for serene, fine-dining vegetarian Korean, or Gaonnuri for Korean BBQ with penthouse views over the city." Never paste the quote or use quotation marks (the card shows it), never cite review percentages, never invent details.
- Don't name the other restaurants; the map shows them. No filler ("solid choices", "you've got options").
- Never mention tools, databases, search steps, embeddings, or IDs.`;

function compactRestaurant(r: any, reason?: MatchReason) {
  return {
    name: r.name,
    why:
      reason && (reason.quote || reason.facts.length || reason.distances.length)
        ? { quote: reason.quote?.text, facts: [...reason.facts, ...reason.distances] }
        : undefined,
    cuisine: r.cuisine,
    price: r.price || undefined,
    neighborhood: r.neighborhood,
    michelin: r.michelin_award || undefined,
    nytTop100Rank: r.nyttop100_rank || undefined,
    restaurantWeekMenus: r.meal_types?.length ? r.meal_types : undefined,
    summary: (r.summary || "").slice(0, 300),
    reviewHighlights: (r.yelp_review_highlights || "").slice(0, 300),
  };
}

/** Tells the model when travel mode/time were assumed, so Remi says so and the user can correct it. */
function assumptionNote(outcome: SearchOutcome): string {
  const travel = "travel" in outcome ? outcome.travel : null;
  if (!travel?.assumed) return "";
  const trip = { walking: "walk", cycling: "bike ride", driving: "drive", transit: "subway/bus ride" }[travel.mode];
  return `\nASSUMED TRAVEL: the user didn't fully specify how they're getting around, so this searched a ${travel.minutes}-minute ${trip}. Mention it in a few words so they can correct it.`;
}

/** Where each place was pinned; only given when travel was assumed, so Remi's assumption
    sentence can name the places. */
function placementNote(outcome: SearchOutcome): string {
  const travel = "travel" in outcome ? outcome.travel : null;
  const locations = ("locations" in outcome ? outcome.locations : []).filter((l) => l.query !== "your location");
  if (!travel?.assumed || !locations.length) return "";
  const pins = locations.map((l) => `"${l.query}" → ${l.formattedAddress}`).join("; ");
  return `\nPLACED ON THE MAP: ${pins}.`;
}

/** Where the shown restaurants are, computed here so Remi never guesses the geography:
    "mostly in Koreatown (3 of 5)" when one neighborhood has at least half, else the list. */
function whereNote(shown: any[]): string {
  const hoods = shown.map((r) => r.neighborhood).filter(Boolean) as string[];
  if (!hoods.length) return "";
  const counts = new Map<string, number>();
  for (const h of hoods) counts.set(h, (counts.get(h) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n === shown.length) return `\nWHERE: all in ${top}`;
  if (n >= 2 && n * 2 >= shown.length) return `\nWHERE: mostly in ${top} (${n} of ${shown.length})`;
  return `\nWHERE: spread across ${[...counts.keys()].slice(0, 4).join(", ")}`;
}

function buildPrompt(userMessage: string, intent: SearchIntent, outcome: SearchOutcome, scope = ""): string {
  const travel = "travel" in outcome ? outcome.travel : null;
  const asked = `USER MESSAGE: ${userMessage}\nSEARCHED FOR: ${describeSearch(intent, travel)}${scope ? `\n${scope}` : ""}${placementNote(outcome)}${assumptionNote(outcome)}`;

  switch (outcome.status) {
    case "chitchat":
      return `${asked}\n\nThe user isn't asking for restaurants. Reply in 1–2 sentences and invite them to ask for a cuisine, vibe, or neighborhood. Do not recommend specific restaurants.`;
    case "lookup_not_found":
      return `${asked}\n\nNone of these restaurants are in the NYC Eats Manhattan list: ${outcome.names.join(", ")}. Say so in one sentence and offer to find something similar. Do not describe the missing restaurant or its food.`;
    case "no_results": {
      const areas = outcome.areaCounts.length
        ? `\nRestaurants inside each travel-time area: ${outcome.areaCounts.join(", ")}${outcome.areaCounts.length > 1 ? " (none were reachable from all locations with the other filters)" : ""}.`
        : "";
      if (intent.kind === "more") {
        return `${asked}\n\nThe user asked for more, but every matching restaurant has already been shown. Say that's the full list in one sentence and suggest one way to widen the search.`;
      }
      const diet = intent.diets.length
        ? `\nNo restaurant here has anything in its description or reviews confirming it's ${intent.diets.join(" / ")}-friendly; say exactly that rather than guessing.`
        : "";
      return `${asked}${areas}${diet}\n\nNothing matched. In 1–2 sentences, say so and suggest one concrete way to loosen the search (more minutes, a different mode of travel, or dropping a filter).`;
    }
    case "ok": {
      const where = whereNote(outcome.shown);
      const area = outcome.areaStats
        ? `\nAREA OVERVIEW (use these numbers; this request wants a fuller overview, up to 5 sentences): ${JSON.stringify(outcome.areaStats)}`
        : "";
      return (
        `${asked}\nTOTAL MATCHES: ${outcome.totalMatches} (showing the top ${outcome.shown.length})${where}${area}\n` +
        `SHOWN RESTAURANTS, in display order:\n${JSON.stringify(outcome.shown.map((r) => compactRestaurant(r, outcome.reasons[r.slug])))}`
      );
    }
    default:
      return asked;
  }
}

/** `scope`: where a follow-up searched (the area already on the map, or all of Manhattan). */
export function narrate(userMessage: string, intent: SearchIntent, outcome: SearchOutcome, scope = "") {
  return streamText({
    model: google(GEMINI_MODEL),
    system: `${PERSONA}\n\n${RULES}`,
    prompt: buildPrompt(userMessage, intent, outcome, scope),
    temperature: 0.4,
    maxOutputTokens: 400,
    providerOptions: NO_THINKING,
  });
}
