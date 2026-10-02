/**
 * Step 3 of the chat pipeline: Remi's reply. Outcomes that need a fixed answer
 * (clarifications, outside Manhattan) get canned text with no LLM call; the
 * rest get one short streamed call that describes restaurants the pipeline
 * already chose — the model never picks or reorders them.
 */
import { streamText } from "ai";
import { GEMINI_MODEL, google, NO_THINKING, type SearchIntent } from "./intent.js";
import { describeSearch, type SearchOutcome } from "./searchPipeline.js";

const OUTSIDE_MANHATTAN =
  "Alas, NYC Eats is limited to Manhattan (for now). If you'd like to add more restaurants, nudge me with a coffee [here](https://buymeacoffee.com/atmikapai).";

/** Fixed reply for outcomes that don't need the LLM, or null if narration should run. */
export function cannedReply(outcome: SearchOutcome): string | null {
  switch (outcome.status) {
    case "needs_travel_mode":
      return `How are you getting around from ${outcome.places.join(" and ")}: walking, biking, transit, or driving? And roughly how many minutes are you willing to travel? (I'll assume 15 if you don't say.)`;
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

const RULES = `Write the reply that accompanies restaurant cards the user can already see.
- 2–3 sentences, no lists, no headings. Never list every restaurant name; the cards show them.
- Highlight 1–2 restaurants with a specific detail taken ONLY from the data given (signature dish, award, standout review point). Never invent facts.
- Never mention tools, databases, search steps, embeddings, or IDs.`;

function compactRestaurant(r: any) {
  return {
    name: r.name,
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

function buildPrompt(userMessage: string, intent: SearchIntent, outcome: SearchOutcome): string {
  const asked = `USER MESSAGE: ${userMessage}\nSEARCHED FOR: ${describeSearch(intent)}`;

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
      return `${asked}${areas}\n\nNothing matched. In 1–2 sentences, say so and suggest one concrete way to loosen the search (more minutes, a different mode of travel, or dropping a filter).`;
    }
    case "ok": {
      const area = outcome.areaStats
        ? `\nAREA OVERVIEW (use these numbers; this request wants a fuller overview, up to 5 sentences): ${JSON.stringify(outcome.areaStats)}`
        : "";
      return (
        `${asked}\nTOTAL MATCHES: ${outcome.totalMatches} (showing the top ${outcome.shown.length})${area}\n` +
        `SHOWN RESTAURANTS, in display order:\n${JSON.stringify(outcome.shown.map(compactRestaurant))}`
      );
    }
    default:
      return asked;
  }
}

export function narrate(userMessage: string, intent: SearchIntent, outcome: SearchOutcome) {
  return streamText({
    model: google(GEMINI_MODEL),
    system: `${PERSONA}\n\n${RULES}`,
    prompt: buildPrompt(userMessage, intent, outcome),
    temperature: 0.4,
    maxOutputTokens: 400,
    providerOptions: NO_THINKING,
  });
}
