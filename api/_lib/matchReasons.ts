/**
 * "Why Remi picked this" for each shown restaurant, rendered under the card and
 * given to the narrator so its reply is grounded in the same evidence.
 *
 * - distances: travel time from each pinned place by the search's mode (miles if
 *   routing is unavailable), for the narrator.
 * - times: walk / bike / transit minutes from each pinned place, shown on the card.
 * - facts: whichever cuisine / price / award / Restaurant Week filters it passed.
 * - quote: for vibe searches, the single sentence from the restaurant's own text
 *   (NYC Tourism's description or Yelp's review summary) that best matches the
 *   vibe, verbatim. Chosen by embedding similarity, so it's the same every time.
 */
import type { MatchReason, Restaurant } from "../../src/types/restaurant.js";
import { drivingMinutes, legFor, modeTimes, type GeocodeResult, type TravelLeg, type TravelMode } from "./geo.js";
import type { SearchIntent } from "./intent.js";
import { hasMichelinStar, isBibGourmand, isNytTop100 } from "./restaurants.js";
import type { SemanticRanker } from "./vectorSearch.js";

export type { MatchReason };

/** Transit times on the card go up to this many minutes (5-min bands, 1 Geoapify credit each);
 *  beyond it the card shows no transit time */
const TRANSIT_TIMES_MAX = 20;

// summary / summary2 come from the restaurant's NYC Tourism Restaurant Week page;
// yelp_review_highlights is Yelp's AI summary of its reviews.
const QUOTE_FIELDS = [
  ["summary", "NYC Tourism"],
  ["summary2", "NYC Tourism"],
  ["yelp_review_highlights", "Yelp reviews"],
] as const;

/** Below this, no sentence is a convincing match and the card shows facts only. */
const MIN_QUOTE_SCORE = 0.62;
/** Card quotes for vibe searches can be a looser match: a shown pick with a relevant-enough
    sentence ("Drinks are mentioned in 46.5% of Yelp reviews…") beats a card with no reason at
    all. Diet evidence keeps the strict MIN_QUOTE_SCORE, since it's proof the place qualifies. */
const MIN_CARD_QUOTE_SCORE = 0.55;

/** A sentence that opens with a contrast is usually the caveat ("However, some reviewers…"). */
const CONTRAST_OPENER = /^(however|but|although|though|unfortunately|that said|on the downside)\b/i;
/** Clearly negative wording (including "it's worse now"): such a sentence never sells the place,
    nor proves it fits a diet. */
const NEGATIVE =
  /\b(disappoint\w*|overpriced|mediocre|bland|rude|underwhelm\w*|complain\w*|complaints?|worst|subpar|lackluster|overrated|soggy|stale|dirty|greasy|inattentive|used to be|no longer|went downhill|not as good)\b/i;

function sentences(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=["“'A-Z0-9])/)
    .map((s) => s.trim())
    // "In Yelp reviews, pasta is mentioned…" → "Pasta is mentioned…"
    .map((s) => s.replace(/^In Yelp reviews,\s*(\w)/i, (_, c: string) => c.toUpperCase()))
    .filter(
      (s) =>
        s.length >= 25 &&
        s.length <= 320 &&
        !/^Yelp categorizes/i.test(s) &&
        !CONTRAST_OPENER.test(s) &&
        !NEGATIVE.test(s)
    );
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

/** "7 min from AMC Empire 25" (travel time by the search's mode), or miles if unavailable. */
function distances(r: Restaurant, locations: GeocodeResult[], legs: (TravelLeg | null)[] | undefined): string[] {
  return locations.map((loc, i) => {
    const place = loc.query === "your location" ? "you" : loc.query;
    const leg = legs?.[i];
    if (leg) return `${leg.upTo ? "≤ " : ""}${leg.minutes} min from ${place}`;
    const miles = milesBetween(loc.latitude, loc.longitude, Number(r.latitude), Number(r.longitude));
    return `${miles.toFixed(1)} mi from ${place}`;
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
export async function findEvidence(
  restaurants: Restaurant[],
  ranker: SemanticRanker,
  minScore = MIN_QUOTE_SCORE
): Promise<Map<string, Quote>> {
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
    if (score >= minScore) evidence.set(slug, { text: candidate.text, field: candidate.field, source: candidate.source });
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
  travel: { mode: TravelMode; minutes: number } | null,
  vibeRanker: SemanticRanker | null,
  dietEvidence: Map<string, Quote>
): Promise<Record<string, MatchReason>> {
  const pins = locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude, isUser: l.query === "your location" }));
  const targets = shown.map((r) => ({ latitude: Number(r.latitude), longitude: Number(r.longitude) }));
  // Travel times and vibe quotes are independent network calls; run them together
  // Transit bands reach at least TRANSIT_TIMES_MAX, further if the search asked for more
  const transitMax = Math.max(TRANSIT_TIMES_MAX, travel?.mode === "transit" ? travel.minutes : 0);
  const [vibeQuotes, times, driving] = await Promise.all([
    vibeRanker ? findEvidence(shown, vibeRanker, MIN_CARD_QUOTE_SCORE) : Promise.resolve(new Map<string, Quote>()),
    pins.length ? modeTimes(pins, targets, transitMax) : Promise.resolve(null),
    travel?.mode === "driving" && pins.length ? drivingMinutes(pins, targets) : Promise.resolve(null),
  ]);
  return Object.fromEntries(
    shown.map((r, j) => {
      const quote = dietEvidence.get(r.slug) ?? vibeQuotes.get(r.slug);
      const rowTimes = times?.map((row) => row[j]);
      // The search's own mode, for the narrator's "N min from …"
      const legs = !travel
        ? undefined
        : travel.mode === "driving"
          ? driving?.map((row) => row[j])
          : rowTimes?.map((t) => legFor(travel.mode as Exclude<TravelMode, "driving">, t));
      return [
        r.slug,
        {
          distances: distances(r, locations, legs),
          ...(pins.length ? { pins } : {}),
          ...(travel ? { travelMode: travel.mode } : {}),
          ...(legs?.some(Boolean) ? { legModes: legs.map((l) => l?.mode ?? null) } : {}),
          ...(rowTimes ? { times: rowTimes } : {}),
          facts: facts(r, intent),
          ...(quote ? { quote } : {}),
        },
      ];
    })
  );
}
