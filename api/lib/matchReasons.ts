/**
 * "Why Remi picked this" for each shown restaurant, rendered under the card and
 * given to the narrator so its reply is grounded in the same evidence.
 *
 * - distances: straight-line miles from each pinned place (shown under the card).
 * - facts: whichever cuisine / price / award / Restaurant Week filters it passed.
 * - quote: for vibe searches, the single sentence from the restaurant's own text
 *   (NYC Tourism's description or Yelp's review summary) that best matches the
 *   vibe, verbatim. Chosen by embedding similarity, so it's the same every time.
 */
import type { MatchReason, Restaurant } from "../../src/types/restaurant.js";
import type { GeocodeResult, TravelMode } from "./geo.js";
import type { SearchIntent } from "./intent.js";
import { hasMichelinStar, isBibGourmand, isNytTop100 } from "./restaurants.js";
import type { SemanticRanker } from "./vectorSearch.js";

export type { MatchReason };

// summary / summary2 come from the restaurant's NYC Tourism Restaurant Week page;
// yelp_review_highlights is Yelp's AI summary of its reviews.
const QUOTE_FIELDS = [
  ["summary", "NYC Tourism"],
  ["summary2", "NYC Tourism"],
  ["yelp_review_highlights", "Yelp reviews"],
] as const;

/** Below this, no sentence is a convincing match and the card shows facts only. */
const MIN_QUOTE_SCORE = 0.62;

function sentences(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=["“'A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 320 && !/^Yelp categorizes/i.test(s));
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

function distances(r: Restaurant, locations: GeocodeResult[]): string[] {
  return locations.map((loc) => {
    const miles = milesBetween(loc.latitude, loc.longitude, Number(r.latitude), Number(r.longitude));
    return `${miles.toFixed(1)} mi from ${loc.query === "your location" ? "you" : loc.query}`;
  });
}

function facts(r: Restaurant, intent: SearchIntent): string[] {
  const out: string[] = [];
  if (intent.cuisines.length && r.cuisine) out.push(r.cuisine);
  if (intent.prices.length && r.price) out.push(r.price);
  if (intent.awards.length) {
    if (hasMichelinStar(r)) out.push(r.michelin_award === "TWO_STARS" ? "Michelin ★★" : r.michelin_award === "THREE_STARS" ? "Michelin ★★★" : "Michelin ★");
    else if (isBibGourmand(r)) out.push("Bib Gourmand");
    if (isNytTop100(r)) out.push(`NYT Top 100 #${r.nyttop100_rank}`);
  }
  if (intent.restaurantWeek && r.meal_types?.length) out.push(r.meal_types.join(" · "));
  return out;
}

type Quote = NonNullable<MatchReason["quote"]>;

/**
 * For each restaurant, its single sentence that best supports `ranker`'s query,
 * kept only if it clears MIN_QUOTE_SCORE. Used both for card quotes and as the
 * evidence that a restaurant really fits a dietary need.
 */
export async function findEvidence(restaurants: Restaurant[], ranker: SemanticRanker): Promise<Map<string, Quote>> {
  const candidates = restaurants.flatMap((r) =>
    QUOTE_FIELDS.flatMap(([field, source]) =>
      sentences((r as any)[field]).map((text) => ({ slug: r.slug, text, field, source }))
    )
  );
  const evidence = new Map<string, Quote>();
  if (!candidates.length) return evidence;

  const scores = await ranker.scoreTexts(candidates.map((c) => c.text));
  const best = new Map<string, { score: number; candidate: (typeof candidates)[number] }>();
  candidates.forEach((candidate, i) => {
    const current = best.get(candidate.slug);
    if (!current || scores[i] > current.score) best.set(candidate.slug, { score: scores[i], candidate });
  });
  for (const [slug, { score, candidate }] of best) {
    if (score >= MIN_QUOTE_SCORE) evidence.set(slug, { text: candidate.text, field: candidate.field, source: candidate.source });
  }
  return evidence;
}

/**
 * Facts for every shown restaurant, plus a quote: the dietary evidence if the user
 * asked for a diet (proof it qualifies), otherwise the best vibe sentence.
 */
export async function buildMatchReasons(
  shown: Restaurant[],
  intent: SearchIntent,
  locations: GeocodeResult[],
  travelMode: TravelMode | null,
  vibeRanker: SemanticRanker | null,
  dietEvidence: Map<string, Quote>
): Promise<Record<string, MatchReason>> {
  const pins = locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude, isUser: l.query === "your location" }));
  const vibeQuotes = vibeRanker ? await findEvidence(shown, vibeRanker) : new Map<string, Quote>();
  return Object.fromEntries(
    shown.map((r) => {
      const quote = dietEvidence.get(r.slug) ?? vibeQuotes.get(r.slug);
      return [
        r.slug,
        {
          distances: distances(r, locations),
          ...(pins.length ? { pins } : {}),
          ...(travelMode ? { travelMode } : {}),
          facts: facts(r, intent),
          ...(quote ? { quote } : {}),
        },
      ];
    })
  );
}
