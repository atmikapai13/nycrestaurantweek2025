/**
 * Restaurant dataset access shared by the chat pipeline: loading, the cuisine
 * vocabulary for intent parsing, fuzzy name matching, and the card payload the
 * frontend's RestaurantCarousel renders.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Restaurant } from "../../src/types/restaurant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const allRestaurants: Restaurant[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../src/data/FinalData.json"), "utf8")
);

/** Distinct cuisine values in the dataset, used as the intent parser's enum. */
export const CUISINES: string[] = [
  ...new Set(allRestaurants.map((r) => r.cuisine).filter((c): c is string => Boolean(c) && c !== "null")),
].sort();

const MICHELIN_STARS = new Set(["ONE_STAR", "TWO_STARS", "THREE_STARS"]);

export const hasMichelinStar = (r: Restaurant) => MICHELIN_STARS.has(r.michelin_award ?? "");
export const isBibGourmand = (r: Restaurant) => r.michelin_award === "BIB_GOURMAND";
export const isNytTop100 = (r: Restaurant) => Boolean(r.nyttop100_rank);
export const isRestaurantWeek = (r: Restaurant) => Array.isArray(r.meal_types) && r.meal_types.length > 0;

/** Keyword backstop for Restaurant Week intent, in case the parser misses it. */
export function mentionsRestaurantWeek(text: string): boolean {
  return /restaurant\s*week|prix\s*fixe|price\s*fix|\$(30|45|60)\b|\brw\s*2026|res\s*week/i.test(text);
}

// ============ Fuzzy matching ============

function normalizeForMatching(str: string): string {
  return str
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+and\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

/** 5-tier match: exact slug → normalized name → partial name (whole words) → slug similarity → Levenshtein. */
export function fuzzyMatchRestaurant(input: string, pool: Restaurant[] = allRestaurants): Restaurant | null {
  if (!input) return null;
  const normalizedInput = normalizeForMatching(input);
  const inputSlug = input.toLowerCase().replace(/\s+/g, "-");

  return (
    pool.find((r) => r.slug === inputSlug || r.slug === input.toLowerCase()) ??
    pool.find((r) => normalizeForMatching(r.name) === normalizedInput) ??
    // Partial match, but only on whole words and not for very short names, so
    // "le bernardin" doesn't match "Le B." and "the" doesn't match everything.
    pool.find((r) => {
      const name = normalizeForMatching(r.name);
      const containsWords = (outer: string, inner: string) =>
        inner.length >= 5 && ` ${outer} `.includes(` ${inner} `);
      return containsWords(name, normalizedInput) || containsWords(normalizedInput, name);
    }) ??
    pool.find((r) => r.slug.includes(normalizedInput.replace(/\s+/g, "-"))) ??
    pool.find(
      (r) => levenshteinDistance(normalizedInput, normalizeForMatching(r.name)) <= (normalizedInput.length < 8 ? 2 : 3)
    ) ??
    null
  );
}

// ============ Card payload ============

/** Fields RestaurantCard needs, with the defaults the old tools applied. */
export function toCard(r: Restaurant): Restaurant {
  return {
    name: r.name,
    slug: r.slug,
    cuisine: r.cuisine || "Unknown",
    price: r.price || "$$",
    neighborhood: r.neighborhood || "",
    borough: r.borough || "",
    latitude: r.latitude,
    longitude: r.longitude,
    yelp_rating: r.yelp_rating || 0,
    yelp_review_count: r.yelp_review_count || 0,
    michelin_award: r.michelin_award || "",
    nyttop100_rank: r.nyttop100_rank || "",
    summary: r.summary || "",
    summary2: r.summary2 || "",
    yelp_review_highlights: r.yelp_review_highlights || "",
    opentable_id: r.opentable_id || "",
    telephone: r.telephone || "",
    address: r.address || "",
    collections: r.collections || [],
    meal_types: r.meal_types || [],
    participation_weeks: r.participation_weeks || [],
    participation_weeks2: r.participation_weeks2 || "",
    website: r.website || "",
    facebook_url: r.facebook_url || "",
    instagram_url: r.instagram_url || "",
    yelp_url: r.yelp_url || "",
    menu_url: r.menu_url || "",
  } as Restaurant;
}
