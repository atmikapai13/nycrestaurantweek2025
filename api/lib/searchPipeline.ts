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
import { semanticRank } from "./vectorSearch.js";

export const RESULTS_PER_PAGE = 5;
const DEFAULT_MINUTES = 15;

/** Reports progress as tool calls; implemented by the route to write stream parts. */
export interface ToolReporter {
  start(toolName: string, input: unknown, options?: { dynamic?: boolean }): string;
  finish(id: string, output: unknown): void;
  fail(id: string, message: string): void;
}

export interface PipelineContext {
  userLocation: { latitude: number; longitude: number } | null;
  filterPool: string[];
  previouslyShown: string[];
  useCache: boolean;
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
      travel: { mode: TravelMode; minutes: number } | null;
      usedSemanticSearch: boolean;
      areaStats?: AreaStats;
    }
  | { status: "no_results"; locations: GeocodeResult[]; travel: { mode: TravelMode; minutes: number } | null; areaCounts: number[] }
  | { status: "needs_travel_mode"; places: string[] }
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
    return { status: "ok", shown: unique.slice(0, RESULTS_PER_PAGE), totalMatches: unique.length, locations: [], travel: null, usedSemanticSearch: false };
  }

  // ---- Where: filter pool ∩ every isochrone ----
  let pool = ctx.filterPool.length
    ? allRestaurants.filter((r) => ctx.filterPool.includes(r.slug))
    : allRestaurants;

  let locations: GeocodeResult[] = [];
  let travel: { mode: TravelMode; minutes: number } | null = null;
  const areaCounts: number[] = [];

  if (intent.locations.length) {
    if (intent.travelMode === "unspecified") return { status: "needs_travel_mode", places: intent.locations };
    travel = { mode: intent.travelMode, minutes: intent.travelMinutes ?? DEFAULT_MINUTES };

    const resolved = await resolveLocations(intent, ctx);
    if (!Array.isArray(resolved)) return resolved;
    locations = resolved;

    const polygons = await Promise.all(
      locations.map(async (loc) => {
        const input = { latitude: loc.latitude, longitude: loc.longitude, mode: travel!.mode, minutes: travel!.minutes };
        const id = ctx.tools.start("get_isoline", input, { dynamic: true });
        try {
          const feature = await isochrone(loc.latitude, loc.longitude, travel!.mode, travel!.minutes, ctx.useCache);
          const inside = restaurantsInPolygon(pool, feature);
          // The frontend reads structuredContent.results[0].geojson to draw the layer.
          ctx.tools.finish(id, {
            structuredContent: { results: [{ geojson: feature }] },
            restaurantSlugs: inside.map((r) => r.slug),
            count: inside.length,
          });
          return { feature, inside };
        } catch (err) {
          ctx.tools.fail(id, err instanceof Error ? err.message : String(err));
          throw err;
        }
      })
    );

    polygons.forEach((p) => areaCounts.push(p.inside.length));
    const reachableFromAll = polygons
      .map((p) => new Set(p.inside.map((r) => r.slug)))
      .reduce((acc, set) => new Set([...acc].filter((slug) => set.has(slug))));
    pool = pool.filter((r) => reachableFromAll.has(r.slug));
  }

  // ---- What: structured filters ----
  const candidates = applyFilters(pool, intent);
  const areaStats = intent.kind === "area_summary" ? computeAreaStats(candidates) : undefined;
  const unseen = intent.kind === "more" ? candidates.filter((r) => !ctx.previouslyShown.includes(r.slug)) : candidates;

  // ---- Order: semantic relevance to the vibes, or quality ----
  let ranked: Restaurant[];
  const usedSemanticSearch = intent.vibes.length > 0;
  if (usedSemanticSearch) {
    const query = intent.vibes.join(", ");
    const id = ctx.tools.start("semantic_search_restaurants", { query, candidates: unseen.length });
    ranked = (await semanticRank(query, unseen, ctx.useCache)).map((s) => s.restaurant);
    ctx.tools.finish(id, {
      restaurantSlugs: ranked.slice(0, RESULTS_PER_PAGE).map((r) => r.slug),
      count: ranked.length,
      restaurantWeekDetected: intent.restaurantWeek,
    });
  } else {
    ranked = [...unseen].sort(byQuality);
  }

  if (!ranked.length) return { status: "no_results", locations, travel, areaCounts };
  return {
    status: "ok",
    shown: ranked.slice(0, RESULTS_PER_PAGE),
    totalMatches: ranked.length,
    locations,
    travel,
    usedSemanticSearch,
    areaStats,
  };
}

/** One-line human description of what was searched, for narration and logs. */
export function describeSearch(intent: SearchIntent): string {
  const parts: string[] = [];
  if (intent.vibes.length) parts.push(intent.vibes.join(", "));
  if (intent.cuisines.length) parts.push(intent.cuisines.join(" or "));
  if (intent.prices.length) parts.push(intent.prices.join("/"));
  if (intent.awards.length) parts.push(intent.awards.map((a) => a.replace(/_/g, " ")).join(" or "));
  if (intent.restaurantWeek) parts.push("Restaurant Week participants");
  if (intent.locations.length) {
    const places = intent.locations.map((l) => (l === MY_LOCATION ? "the user's location" : l)).join(" and ");
    const minutes = intent.travelMinutes ?? DEFAULT_MINUTES;
    parts.push(`within ${minutes} min ${intent.travelMode} of ${places}`);
  }
  return parts.join(" · ") || "restaurants";
}
