/**
 * Restaurant metadata computation utilities
 * Aggregates statistics and insights from restaurant arrays
 */

import type { Restaurant } from '../types/restaurant';

export interface RestaurantMetadata {
  total_count: number;
  cuisine_breakdown: Record<string, number>;
  top_cuisines: string[];
  borough_breakdown: Record<string, number>;
  top_neighborhoods: string[];
  price_breakdown: { 
    $: number; 
    $$: number; 
    $$$: number; 
    $$$$: number; 
  };
  avg_rating: number;
  rating_range: [number, number];
  michelin_count: number;
  michelin_types: string[];
  nyt_count: number;
  collections_present: string[];
  has_awards: boolean;
  message?: string;
}

/**
 * Computes aggregate metadata from restaurant array for intelligent summaries
 * Performance: O(n) single pass, ~5-10ms for 628 restaurants
 * 
 * @param restaurants - Array of restaurants to analyze
 * @returns Metadata object with statistics and breakdowns
 */
export function computeResultMetadata(restaurants: Restaurant[]): RestaurantMetadata {
  if (restaurants.length === 0) {
    return {
      total_count: 0,
      message: "No restaurants match your current filters.",
      cuisine_breakdown: {},
      top_cuisines: [],
      borough_breakdown: {},
      top_neighborhoods: [],
      price_breakdown: { $: 0, $$: 0, $$$: 0, $$$$: 0 },
      avg_rating: 0,
      rating_range: [5, 0],
      michelin_count: 0,
      michelin_types: [],
      nyt_count: 0,
      collections_present: [],
      has_awards: false,
    };
  }

  const metadata: RestaurantMetadata = {
    total_count: restaurants.length,
    cuisine_breakdown: {},
    top_cuisines: [],
    borough_breakdown: {},
    top_neighborhoods: [],
    price_breakdown: { $: 0, $$: 0, $$$: 0, $$$$: 0 },
    avg_rating: 0,
    rating_range: [5, 0],
    michelin_count: 0,
    michelin_types: [],
    nyt_count: 0,
    collections_present: [],
    has_awards: false,
  };

  let totalRating = 0;
  let ratingCount = 0;
  const neighborhoodCounts: Record<string, number> = {};
  const collectionSet = new Set<string>();
  const michelinSet = new Set<string>();

  // Single pass through restaurants
  restaurants.forEach((r) => {
    // Cuisine
    if (r.cuisine) {
      metadata.cuisine_breakdown[r.cuisine] =
        (metadata.cuisine_breakdown[r.cuisine] || 0) + 1;
    }

    // Borough
    if (r.borough) {
      metadata.borough_breakdown[r.borough] =
        (metadata.borough_breakdown[r.borough] || 0) + 1;
    }

    // Neighborhood
    if (r.neighborhood) {
      neighborhoodCounts[r.neighborhood] =
        (neighborhoodCounts[r.neighborhood] || 0) + 1;
    }

    // Price
    if (r.price && r.price in metadata.price_breakdown) {
      metadata.price_breakdown[
        r.price as keyof typeof metadata.price_breakdown
      ]++;
    }

    // Rating
    if (r.yelp_rating && r.yelp_rating > 0) {
      totalRating += r.yelp_rating;
      ratingCount++;
      metadata.rating_range[0] = Math.min(
        metadata.rating_range[0],
        r.yelp_rating
      );
      metadata.rating_range[1] = Math.max(
        metadata.rating_range[1],
        r.yelp_rating
      );
    }

    // Awards
    if (r.michelin_award) {
      metadata.michelin_count++;
      michelinSet.add(r.michelin_award);
      metadata.has_awards = true;
    }

    if (r.nyttop100_rank) {
      metadata.nyt_count++;
      metadata.has_awards = true;
    }

    // Collections
    r.collections?.forEach((c) => collectionSet.add(c));
  });

  // Compute derived fields
  metadata.avg_rating =
    ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0;

  // Top 3 cuisines
  metadata.top_cuisines = Object.entries(metadata.cuisine_breakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cuisine]) => cuisine);

  // Top 3 neighborhoods
  metadata.top_neighborhoods = Object.entries(neighborhoodCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([hood]) => hood);

  metadata.michelin_types = Array.from(michelinSet);
  metadata.collections_present = Array.from(collectionSet);

  return metadata;
}

