import { useMemo } from "react";
import type { Restaurant } from "@/types/restaurant";
import { useMap } from "@/contexts/MapContext";
import { asset } from "@/utils/asset";
import type { FilterOption } from "./FilterDropdown";

/** Dropdown filter keys, as stored in MapContext's activeFilters. */
export type FilterKey = "Price" | "Yelp Rating" | "Cuisine" | "Badges" | "Meal Types";

const PRICES = ["$", "$$", "$$$", "$$$$"];
const RATINGS = [
  { value: "3.0", label: "★★★", threshold: 3.0 },
  { value: "3.5", label: "★★★☆", threshold: 3.5 },
  { value: "4.0", label: "★★★★", threshold: 4.0 },
  { value: "4.5", label: "★★★★☆", threshold: 4.5 },
];
const MICHELIN_STARS = ["ONE_STAR", "TWO_STARS", "THREE_STARS"];
const MEAL_TYPE_ORDER = ["$30", "$45", "$60", "brunch", "lunch", "dinner"];

const priceOf = (r: Restaurant) => ((r as any).price ?? r.price_range) as string | undefined;
const ratingOf = (r: Restaurant) => (r as any).yelp_rating as number | undefined;
const reviewCountOf = (r: Restaurant) => (r as any).yelp_review_count as number | undefined;

function matchesBadge(r: Restaurant, badge: string): boolean {
  switch (badge) {
    case "michelin":
      return !!r.michelin_award && MICHELIN_STARS.includes(r.michelin_award);
    case "bib":
      return r.michelin_award === "BIB_GOURMAND";
    case "nyt":
      return Boolean(r.nyttop100_rank);
    default:
      return false;
  }
}

function matchesFilter(r: Restaurant, key: string, values: string[]): boolean {
  switch (key) {
    case "Cuisine":
      if (!r.cuisine) return false;
      return values.some((v) => r.cuisine === v || r.cuisine.toLowerCase().includes(v.toLowerCase()));
    case "Meal Types":
      return Array.isArray(r.meal_types) && values.some((m) => r.meal_types?.includes(m));
    case "Price":
      return values.includes(priceOf(r) as string);
    case "Yelp Rating": {
      const rating = ratingOf(r);
      if (typeof rating !== "number") return false;
      const thresholds = values.map(parseFloat).filter((n) => !Number.isNaN(n));
      return thresholds.length === 0 || rating >= Math.min(...thresholds);
    }
    case "Badges":
      return values.some((b) => matchesBadge(r, b));
    default:
      return true;
  }
}

/** Count restaurants per key; `keysOf` returns the keys a restaurant contributes to. */
function countBy(restaurants: Restaurant[], keysOf: (r: Restaurant) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of restaurants) for (const k of keysOf(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
}

/**
 * Options for each filter dropdown, with live counts. Each dropdown counts the restaurants
 * left after every *other* active filter, and (when anything else is filtering) disables
 * options that would give zero results.
 */
export function useFilterOptions() {
  const {
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  } = useMap();

  return useMemo(() => {
    const inRegion = isochroneRegionSlugs ? new Set(isochroneRegionSlugs) : null;

    // Restaurants passing every active filter except `exclude`
    const filteredExcept = (exclude: FilterKey): Restaurant[] =>
      allRestaurants.filter((r) => {
        if (inRegion && !inRegion.has(r.slug)) return false;
        for (const [key, values] of Object.entries(activeFilters)) {
          if (key !== exclude && values.length > 0 && !matchesFilter(r, key, values)) return false;
        }
        if (restaurantWeekActive && !(Array.isArray(r.meal_types) && r.meal_types.length > 0)) return false;
        if (favoritesActive && !favorites.includes(r.name)) return false;
        if (hasMenuActive && !r.menu_url?.trim()) return false;
        if (highReviewCountActive) {
          const n = reviewCountOf(r);
          if (!(typeof n === "number" && n >= 500)) return false;
        }
        return true;
      });

    // Is anything other than `exclude` filtering? Only then are zero-count options disabled.
    const othersActive = (exclude: FilterKey) =>
      inRegion !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some((k) => k !== exclude && activeFilters[k]?.length > 0);

    const option = (exclude: FilterKey, value: string, label: string, count: number, icon?: string): FilterOption => ({
      value,
      label,
      count,
      icon,
      disabled: othersActive(exclude) && count === 0,
    });

    // Price
    const priceCounts = countBy(filteredExcept("Price"), (r) => (priceOf(r) ? [priceOf(r)!] : []));
    const priceOptions = PRICES.map((p) => option("Price", p, p, priceCounts.get(p) ?? 0));

    // Yelp rating: "at least" thresholds
    const rated = filteredExcept("Yelp Rating").map(ratingOf);
    const ratingOptions = RATINGS.map(({ value, label, threshold }) =>
      option("Yelp Rating", value, label, rated.filter((x) => typeof x === "number" && x >= threshold).length)
    );

    // Cuisine: every cuisine in the dataset, counted within the filtered set
    const allCuisines = [...new Set(allRestaurants.map((r) => r.cuisine).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
    const cuisineCounts = countBy(filteredExcept("Cuisine"), (r) => (r.cuisine ? [r.cuisine] : []));
    const cuisineOptions: FilterOption[] = allCuisines.length
      ? allCuisines.map((c) => option("Cuisine", c, c, cuisineCounts.get(c) ?? 0))
      : [{ value: "", label: "No cuisines available", disabled: true }];

    // Awards
    const awarded = filteredExcept("Badges");
    const awardCount = (b: string) => awarded.filter((r) => matchesBadge(r, b)).length;
    const badgeOptions = [
      option("Badges", "michelin", "Michelin", awardCount("michelin"), asset("/MichelinStar.svg.png")),
      option("Badges", "bib", "Bib Gourmand", awardCount("bib"), asset("/bibgourmand.png")),
      option("Badges", "nyt", "NYT Top 100", awardCount("nyt"), asset("/nytimes.png")),
    ];

    // Restaurant Week prix fixe types (filter hidden until the next Restaurant Week)
    const rank = (m: string) => {
      const i = MEAL_TYPE_ORDER.indexOf(m.toLowerCase());
      return i === -1 ? Infinity : i;
    };
    const allMealTypes = [...new Set(allRestaurants.flatMap((r) => (Array.isArray(r.meal_types) ? r.meal_types : [])))]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const mealCounts = countBy(filteredExcept("Meal Types"), (r) => (Array.isArray(r.meal_types) ? r.meal_types : []));
    const mealTypesOptions: FilterOption[] = allMealTypes.length
      ? allMealTypes.map((m) => option("Meal Types", m, m, mealCounts.get(m) ?? 0))
      : [{ value: "", label: "No meal types available", disabled: true }];

    return { priceOptions, ratingOptions, cuisineOptions, badgeOptions, mealTypesOptions };
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);
}
