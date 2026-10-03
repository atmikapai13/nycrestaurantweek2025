/**
 * Step 2 of the chat pipeline: execute a SearchIntent with plain code — no LLM.
 * Same intent + same data ⇒ same restaurants, in the same order.
 *
 *   locations → geocode (parallel) → isochrones (parallel) → intersect
 *   → filter pool / cuisine / price / awards / Restaurant Week
 *   → rank (semantic if vibes were given, otherwise a fixed quality score) → top 5
 *
 * Progress is reported through `tools` so the route can stream the same tool
 * parts the frontend already renders (geocode markers, isochrone layers, cards).
 */
import type { Restaurant } from "../../src/types/restaurant.js";
import {
  geocode,
  GeocodeNotFoundError,
  isInsideManhattanBounds,
  isochrone,
  OutsideManhattanError,
  restaurantsInPolygon,
  type GeocodeResult,
  type TravelMode,
} from "./geo.js";
import { MY_LOCATION, type SearchIntent } from "./intent.js";
import {
  allRestaurants,
  fuzzyMatchRestaurant,
  hasMichelinStar,
  isBibGourmand,
  isNytTop100,
  isRestaurantWeek,
} from "./restaurants.js";
import { buildMatchReasons, findEvidence, type MatchReason } from "./matchReasons.js";
import { createSemanticRanker } from "./vectorSearch.js";

export const RESULTS_PER_PAGE = 5;

// Minimum on-screen time for the map "beats" (Geocoding… → Mapping… → Tasting…), so
// the pin drop and the isochrone camera sweep read as distinct moments even when the
// work itself is near-instant. Only pads the difference; slow steps aren't delayed.
const GEOCODE_DWELL_MS = 500;
const MAP_DWELL_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Wait until at least `minMs` has passed since `since` (performance.now()). */
const dwell = (since: number, minMs: number) => sleep(Math.max(0, minMs - (performance.now() - since)));

export interface Travel {
  mode: TravelMode;
  minutes: number;
  /** True when the user didn't specify mode and/or minutes and a default was used. */
  assumed: boolean;
}

/**
 * Travel settings to try, narrowest first. Anything the user stated is kept;
 * whatever they left out widens step by step until something matches, so results
 * stay as local as possible (and "show me more" widens once nearby matches run out).
 * Defaults come from measured coverage: a 15-min walk keeps "near X" local for one
 * place, but two people's walking areas rarely overlap, while 20-min transit does.
 */
function travelPlan(intent: SearchIntent): Travel[] {
  const { travelMode: mode, travelMinutes: minutes } = intent;
  if (mode !== "unspecified" && minutes != null) return [{ mode, minutes, assumed: false }];
  if (mode !== "unspecified") return [15, 20, 25].map((m) => ({ mode, minutes: m, assumed: true }));
  if (minutes != null) {
    return (["walking", "transit"] as const).map((m) => ({ mode: m, minutes, assumed: true }));
  }
  const steps: Array<[TravelMode, number]> =
    intent.locations.length > 1
      ? [["transit", 20], ["transit", 25]]
      : [["walking", 15], ["transit", 15], ["transit", 20], ["transit", 25]];
  return steps.map(([m, n]) => ({ mode: m, minutes: n, assumed: true }));
}

/** Reports progress as tool calls; implemented by the route to write stream parts. */
export interface ToolReporter {
  start(toolName: string, input: unknown, options?: { dynamic?: boolean }): string;
  finish(id: string, output: unknown): void;
  fail(id: string, message: string): void;
  /** Time work that isn't streamed as a tool part (e.g. isochrones tried while widening). */
  measure<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T>;
}

export interface PipelineContext {
  userLocation: { latitude: number; longitude: number } | null;
  filterPool: string[];
  previouslyShown: string[];
  useCache: boolean;
  /** Pad stages to their minimum on-screen time (off for benchmarks). */
  pacing: boolean;
  tools: ToolReporter;
}

export interface AreaStats {
  total: number;
  topCuisines: Array<{ cuisine: string; count: number }>;
  michelinStars: number;
  bibGourmands: number;
  nytTop100: number;
  priceMix: Record<string, number>;
}

export type SearchOutcome =
  | {
      status: "ok";
      shown: Restaurant[];
      totalMatches: number;
      locations: GeocodeResult[];
      travel: Travel | null;
      usedSemanticSearch: boolean;
      areaStats?: AreaStats;
      /** Why each shown restaurant was picked, keyed by slug (empty for lookups). */
      reasons: Record<string, MatchReason>;
    }
  | { status: "no_results"; locations: GeocodeResult[]; travel: Travel | null; areaCounts: number[] }
  | { status: "needs_user_location" }
  | { status: "outside_manhattan"; place: string }
  | { status: "location_not_found"; place: string }
  | { status: "lookup_not_found"; names: string[] }
  | { status: "chitchat" };

/** Deterministic "best of" ordering used when there's no vibe to rank by. */
function qualityScore(r: Restaurant): number {
  const reviews = Number(r.yelp_review_count) || 0;
  const rating = Number(r.yelp_rating) || 0;
  const awardBonus = hasMichelinStar(r) ? 3 : isNytTop100(r) ? 2 : isBibGourmand(r) ? 1.5 : 0;
  return rating * Math.log10(reviews + 10) + awardBonus;
}

function byQuality(a: Restaurant, b: Restaurant): number {
  return qualityScore(b) - qualityScore(a) || a.slug.localeCompare(b.slug);
}

function computeAreaStats(restaurants: Restaurant[]): AreaStats {
  const cuisineCounts = new Map<string, number>();
  const priceMix: Record<string, number> = {};
  for (const r of restaurants) {
    if (r.cuisine) cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) ?? 0) + 1);
    const price = r.price || "unlisted";
    priceMix[price] = (priceMix[price] ?? 0) + 1;
  }
  return {
    total: restaurants.length,
    topCuisines: [...cuisineCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([cuisine, count]) => ({ cuisine, count })),
    michelinStars: restaurants.filter(hasMichelinStar).length,
    bibGourmands: restaurants.filter(isBibGourmand).length,
    nytTop100: restaurants.filter(isNytTop100).length,
    priceMix,
  };
}

function applyFilters(pool: Restaurant[], intent: SearchIntent): Restaurant[] {
  return pool.filter((r) => {
    if (intent.cuisines.length && !intent.cuisines.includes(r.cuisine)) return false;
    if (intent.prices.length && !intent.prices.includes(r.price as any)) return false;
    if (intent.awards.length) {
      const matchesAward =
        (intent.awards.includes("michelin_star") && hasMichelinStar(r)) ||
        (intent.awards.includes("bib_gourmand") && isBibGourmand(r)) ||
        (intent.awards.includes("nyt_top_100") && isNytTop100(r));
      if (!matchesAward) return false;
    }
    if (intent.restaurantWeek && !isRestaurantWeek(r)) return false;
    return true;
  });
}

async function resolveLocations(
  intent: SearchIntent,
  ctx: PipelineContext
): Promise<GeocodeResult[] | SearchOutcome> {
  if (intent.locations.includes(MY_LOCATION) && !ctx.userLocation) return { status: "needs_user_location" };

  const results = await Promise.all(
    intent.locations.map(async (place) => {
      if (place === MY_LOCATION) {
        const { latitude, longitude } = ctx.userLocation!;
        if (!isInsideManhattanBounds(latitude, longitude)) return { status: "outside_manhattan", place: "your location" } as const;
        return { query: "your location", latitude, longitude, formattedAddress: "Your location" };
      }
      const id = ctx.tools.start("geocode", { address: place }, { dynamic: true });
      try {
        const result = await geocode(place, ctx.useCache);
        // Same shape the MCP geocoder returned; the frontend reads structuredContent.results[0].
        ctx.tools.finish(id, { structuredContent: { query: place, results: [result] } });
        return result;
      } catch (err) {
        ctx.tools.fail(id, err instanceof Error ? err.message : String(err));
        if (err instanceof OutsideManhattanError) return { status: "outside_manhattan", place } as const;
        if (err instanceof GeocodeNotFoundError) return { status: "location_not_found", place } as const;
        throw err;
      }
    })
  );

  const failure = results.find((r) => "status" in r);
  return failure && "status" in failure ? failure : (results as GeocodeResult[]);
}

export async function runSearch(intent: SearchIntent, ctx: PipelineContext): Promise<SearchOutcome> {
  if (intent.kind === "chitchat") return { status: "chitchat" };

  if (intent.kind === "lookup") {
    const matches = intent.restaurantNames
      .map((name) => fuzzyMatchRestaurant(name))
      .filter((r): r is Restaurant => r !== null);
    const unique = [...new Map(matches.map((r) => [r.slug, r])).values()];
    if (!unique.length) return { status: "lookup_not_found", names: intent.restaurantNames };
    return {
      status: "ok",
      shown: unique.slice(0, RESULTS_PER_PAGE),
      totalMatches: unique.length,
      locations: [],
      travel: null,
      usedSemanticSearch: false,
      reasons: {},
    };
  }

  const basePool = ctx.filterPool.length
    ? allRestaurants.filter((r) => ctx.filterPool.includes(r.slug))
    : allRestaurants;

  // Vibes and diets both steer ranking; diets are also strict: a restaurant only counts
  // if one of its own sentences supports the diet (so "vegan" never shows Veselka).
  const semanticQuery = [...intent.vibes, ...intent.diets].join(", ");
  const vibeQuery = intent.vibes.join(", ");
  const dietQuery = intent.diets.join(", ");
  // One embedding per distinct query, fetched in parallel.
  const [ranker, vibeOnly, dietOnly] = await Promise.all([
    semanticQuery ? createSemanticRanker(semanticQuery, ctx.useCache) : null,
    vibeQuery && dietQuery ? createSemanticRanker(vibeQuery, ctx.useCache) : null,
    vibeQuery && dietQuery ? createSemanticRanker(dietQuery, ctx.useCache) : null,
  ]);
  const vibeRanker = vibeQuery ? (vibeOnly ?? ranker) : null;
  const dietRanker = dietQuery ? (dietOnly ?? ranker) : null;
  const dietEvidence = new Map<string, NonNullable<MatchReason["quote"]>>();

  // Ranks a pool: filters, drops already-shown ("more"), orders by vibe/diet or quality,
  // and for diets keeps only restaurants with supporting evidence.
  const DIET_CHECK_LIMIT = 25;
  const rank = async (pool: Restaurant[]) => {
    const candidates = applyFilters(pool, intent);
    const unseen = intent.kind === "more" ? candidates.filter((r) => !ctx.previouslyShown.includes(r.slug)) : candidates;
    let ranked = ranker ? ranker.rank(unseen).map((s) => s.restaurant) : [...unseen].sort(byQuality);
    if (dietRanker) {
      const checked = ranked.slice(0, DIET_CHECK_LIMIT);
      const evidence = await ctx.tools.measure("diet evidence", { diets: intent.diets, checked: checked.length }, () =>
        findEvidence(checked, dietRanker)
      );
      evidence.forEach((quote, slug) => dietEvidence.set(slug, quote));
      ranked = checked.filter((r) => evidence.has(r.slug));
    }
    return { candidates, ranked };
  };

  let locations: GeocodeResult[] = [];
  let travel: Travel | null = null;
  let areaCounts: number[] = [];
  let result = intent.locations.length ? { candidates: [] as Restaurant[], ranked: [] as Restaurant[] } : await rank(basePool);

  if (intent.locations.length) {
    const resolved = await resolveLocations(intent, ctx);
    if (!Array.isArray(resolved)) return resolved;
    locations = resolved;
    const geocodedAt = performance.now();

    // Try each travel setting until something matches, then draw only that one.
    const plan = travelPlan(intent);
    let chosen: { travel: Travel; areas: Array<{ feature: Awaited<ReturnType<typeof isochrone>>; inside: Restaurant[] }> } | null = null;
    for (const [i, step] of plan.entries()) {
      let areas;
      try {
        areas = await Promise.all(
          locations.map(async (loc) => {
            const feature = await ctx.tools.measure("isochrone", { ...step, place: loc.query }, () =>
              isochrone(loc.latitude, loc.longitude, step.mode, step.minutes, ctx.useCache)
            );
            return { feature, inside: restaurantsInPolygon(basePool, feature) };
          })
        );
      } catch (err) {
        // A slow/failed step falls through to the next, wider one; only the last step is fatal.
        if (i < plan.length - 1) continue;
        throw err;
      }
      const reachableFromAll = areas
        .map((a) => new Set(a.inside.map((r) => r.slug)))
        .reduce((acc, set) => new Set([...acc].filter((slug) => set.has(slug))));
      result = await rank(basePool.filter((r) => reachableFromAll.has(r.slug)));
      chosen = { travel: step, areas };
      if (result.ranked.length > 0) break;
    }

    travel = chosen!.travel;
    areaCounts = chosen!.areas.map((a) => a.inside.length);
    // Let the pin drop register before the isochrone appears (skipped for "near me": no pin)
    if (ctx.pacing && intent.locations.some((l) => l !== MY_LOCATION)) await dwell(geocodedAt, GEOCODE_DWELL_MS);
    chosen!.areas.forEach((area, i) => {
      const loc = locations[i];
      const id = ctx.tools.start(
        "get_isoline",
        { latitude: loc.latitude, longitude: loc.longitude, mode: travel!.mode, minutes: travel!.minutes },
        { dynamic: true }
      );
      // The frontend reads structuredContent.results[0].geojson to draw the layer.
      ctx.tools.finish(id, {
        structuredContent: { results: [{ geojson: area.feature }] },
        restaurantSlugs: area.inside.map((r) => r.slug),
        count: area.inside.length,
      });
    });
  }

  const mappedAt = performance.now();
  const { candidates, ranked } = result;
  const shown = ranked.slice(0, RESULTS_PER_PAGE);
  const reasons = shown.length
    ? await ctx.tools.measure("match reasons", { count: shown.length }, () =>
        buildMatchReasons(shown, intent, locations, travel, vibeRanker, dietEvidence)
      )
    : {};
  // Hold "Mapping…" while the camera sweeps to the isochrone, before results arrive
  if (ctx.pacing && locations.length) await dwell(mappedAt, MAP_DWELL_MS);

  const usedSemanticSearch = ranker !== null;
  if (usedSemanticSearch) {
    const id = ctx.tools.start("semantic_search_restaurants", { query: semanticQuery });
    ctx.tools.finish(id, {
      restaurantSlugs: shown.map((r) => r.slug),
      count: ranked.length,
      restaurantWeekDetected: intent.restaurantWeek,
    });
  }

  if (!ranked.length) return { status: "no_results", locations, travel, areaCounts };
  return {
    status: "ok",
    shown,
    reasons,
    totalMatches: ranked.length,
    locations,
    travel,
    usedSemanticSearch,
    areaStats: intent.kind === "area_summary" ? computeAreaStats(candidates) : undefined,
  };
}

/** One-line human description of what was searched, for narration and logs. */
export function describeSearch(intent: SearchIntent, travel: Travel | null = null): string {
  const parts: string[] = [];
  if (intent.vibes.length) parts.push(intent.vibes.join(", "));
  if (intent.diets.length) parts.push(intent.diets.join(" + "));
  if (intent.cuisines.length) parts.push(intent.cuisines.join(" or "));
  if (intent.prices.length) parts.push(intent.prices.join("/"));
  if (intent.awards.length) parts.push(intent.awards.map((a) => a.replace(/_/g, " ")).join(" or "));
  if (intent.restaurantWeek) parts.push("Restaurant Week participants");
  if (intent.locations.length) {
    const places = intent.locations.map((l) => (l === MY_LOCATION ? "the user's location" : l)).join(" and ");
    const mode = travel?.mode ?? intent.travelMode;
    const minutes = travel?.minutes ?? intent.travelMinutes;
    parts.push(`within ${minutes ?? "?"} min ${mode} of ${places}`);
  }
  return parts.join(" · ") || "restaurants";
}
