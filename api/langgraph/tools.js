import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  loadRestaurantData,
  filterRestaurants as filterData,
  getRestaurantBySlug
} from '../utils/dataLoader.js';
import { performRagSearch } from '../lib/ragSearchLogic.js';
import { geocodeAddress } from '../lib/geocodeLogic.js';
import { generateIsochrone, generateMultiPartyIsochrone } from '../lib/isochroneLogic.js';

/**
 * ============================================================================
 * FILTERING ARCHITECTURE INVARIANTS
 * ============================================================================
 *
 * 1. allRestaurantSlugs (in isochroneParams) = BASE LIST for filtering
 *    - Sticky: persists until reset or new isochrone
 *    - Source: All restaurants spatially inside isochrone polygon
 *
 * 2. visibleRestaurants (in state) = PINK MARKER subset only
 *    - Replaced on every tool call
 *    - Source: Filtered results from most recent query
 *    - NEVER used for filtering, only for map visualization
 *
 * 3. FILTERING IS INDIVIDUAL, NOT STACKED:
 *    - Each filter query searches the SAME base list (allRestaurantSlugs)
 *    - NOT filtered on top of previous results
 *    - Example: Isochrone (66) → Italian (7) → Japanese searches 66, NOT 7
 * ============================================================================
 */

/**
 * Get the search pool for filtering operations
 *
 * Returns:
 * - If scopeToIsochrone=true AND isochrone exists: restaurants in allRestaurantSlugs (base list)
 * - Otherwise: null (signals to use full dataset of 628 restaurants)
 *
 * CRITICAL: NEVER returns visibleRestaurants (that's only for pink markers)
 */
async function getScopedSearchPool(scopeToIsochrone) {
  if (!scopeToIsochrone) {
    return null; // Signal to use full dataset
  }

  try {
    const { getCurrentAgentState } = await import('./agent.js');
    const state = getCurrentAgentState();

    // Check for allRestaurantSlugs (works for both single and multi-party isochrones)
    if (state.isochroneParams?.allRestaurantSlugs?.length > 0) {
      const allRestaurants = loadRestaurantData();
      const searchPool = allRestaurants.filter(r =>
        state.isochroneParams.allRestaurantSlugs.includes(r.slug)
      );

      const isoType = state.isochroneParams.operation ? 'multi-party' : 'single-party';
      console.log(`🔍 Scoped search pool: ${searchPool.length} restaurants (${isoType} isochrone base)`);
      return searchPool;
    }

    // No isochrone → use full dataset
    console.log(`🔍 No isochrone found - will search full dataset`);
    return null;
  } catch (e) {
    console.warn("❌ Could not access agent state for scoping:", e);
    return null;
  }
}

/**
 * Apply filters manually to a restaurant array
 * Used when filtering a scoped search pool (isochrone base) or full dataset
 */
function applyFiltersManually(restaurants, { cuisines = [], priceLevels = [], neighborhoods = [], minRating = 0, awards = [] }) {
  return restaurants.filter(r => {
    // Cuisine filter
    if (cuisines.length > 0 && !cuisines.some(c =>
      r.cuisine?.toLowerCase().includes(c.toLowerCase())
    )) return false;

    // Price filter
    if (priceLevels.length > 0 && !priceLevels.includes(r.price)) return false;

    // Neighborhood filter
    if (neighborhoods.length > 0 && !neighborhoods.some(n =>
      r.neighborhood?.toLowerCase().includes(n.toLowerCase()) ||
      r.borough?.toLowerCase().includes(n.toLowerCase())
    )) return false;

    // Rating filter
    if (minRating > 0 && (r.yelp_rating || 0) < minRating) return false;

    // Awards filter
    if (awards.length > 0 && !awards.some(a => {
      if (a === 'michelin') return r.michelin_award;
      if (a === 'bib_gourmand') return r.bib_gourmand;
      if (a === 'nyt_top_100') return r.nyttop100_rank;
      return false;
    })) return false;

    return true;
  });
}

/**
 * Tool 1: Filter restaurants
 */
export const filterRestaurants = new DynamicStructuredTool({
  name: "filter_restaurants",
  description: `Filter restaurants by multiple criteria. Returns metadata summary.
Use for structured queries like "Japanese restaurants in Brooklyn" or "Michelin-starred places".`,

  schema: z.object({
    cuisines: z.array(z.string()).optional().describe("Cuisine types"),
    priceLevels: z.array(z.string()).optional().describe("Price: $, $$, $$$, $$$$"),
    neighborhoods: z.array(z.string()).optional().describe("NYC neighborhoods"),
    minRating: z.number().optional().describe("Min Yelp rating (0-5)"),
    awards: z.array(z.string()).optional().describe("michelin, bib_gourmand, nyt_top_100"),
    scopeToIsochrone: z.boolean().default(true).describe("If true and isochrone exists: search within isochrone base list. If false: search all 628 restaurants. Filters are NOT stacked - each query searches the same base.")
  }),

  func: async ({ cuisines = [], priceLevels = [], neighborhoods = [], minRating = 0, awards = [], scopeToIsochrone = true }) => {
    // Step 1: Get search pool (isochrone base or full dataset)
    const searchPool = await getScopedSearchPool(scopeToIsochrone);
    const baseIsochroneSlugs = searchPool
      ? searchPool.map(r => r.slug)
      : null;

    // Step 2: Apply filters (against base list, NOT stacked on previous results)
    const filtered = searchPool
      ? applyFiltersManually(searchPool, { cuisines, priceLevels, neighborhoods, minRating, awards })
      : filterData({ cuisines, priceLevels, neighborhoods, minRating, awards });

    // Calculate summary
    const cuisineCount = {};
    const neighborhoodCount = {};
    const priceCount = { "$": 0, "$$": 0, "$$$": 0, "$$$$": 0 };
    let totalRating = 0;

    filtered.forEach(r => {
      cuisineCount[r.cuisine] = (cuisineCount[r.cuisine] || 0) + 1;
      neighborhoodCount[r.neighborhood] = (neighborhoodCount[r.neighborhood] || 0) + 1;
      if (r.price) priceCount[r.price]++;
      totalRating += r.yelp_rating || 0;
    });

    const topCuisines = Object.entries(cuisineCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);

    const topNeighborhoods = Object.entries(neighborhoodCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n]) => n);

    // Extract slugs for map actions
    const slugs = filtered.map(r => r.slug);

    // Build map actions - preserve isochrone if scoping
    const mapActions = [];

    // If scoping to isochrone, preserve the isochrone visualization
    if (scopeToIsochrone && baseIsochroneSlugs) {
      try {
        const { getCurrentAgentState } = await import('./agent.js');
        const state = getCurrentAgentState();
        if (state.isochroneParams?.polygon) {
          mapActions.push({
            mapAction: 'showIsochrone',
            polygon: state.isochroneParams.polygon,
            allRestaurantSlugs: baseIsochroneSlugs,
            fitBounds: false  // Don't re-fit, just maintain the polygon
          });
        }
      } catch (e) {
        console.warn("❌ Could not access isochrone params:", e);
      }
    }

    // Always add restaurant highlights
    mapActions.push({
      mapAction: 'highlightRestaurants',
      slugs,
      count: slugs.length
    });

    return JSON.stringify({
      count: filtered.length,
      restaurants: filtered.slice(0, 20).map(r => ({
        name: r.name,
        slug: r.slug,
        cuisine: r.cuisine,
        rating: r.yelp_rating,
        price: r.price,
        neighborhood: r.neighborhood
      })),
      summary: {
        topCuisines,
        topNeighborhoods,
        priceDistribution: priceCount,
        avgRating: filtered.length > 0 ? (totalRating / filtered.length).toFixed(1) : 0
      },
      // Auto-return map actions for visualization
      mapActions
    });
  }
});

/**
 * Tool 2: Get restaurant details
 */
export const getRestaurantDetails = new DynamicStructuredTool({
  name: "get_restaurant_details",
  description: `Get comprehensive restaurant details.
Use when user asks "tell me about [restaurant]" or "what's the vibe".`,

  schema: z.object({
    restaurantSlug: z.string().describe("Restaurant slug"),
    detailType: z.enum(["full", "vibe", "reviews", "dishes", "pricing"]).default("full")
  }),

  func: async ({ restaurantSlug, detailType }) => {
    const { getRestaurantByNameOrSlug } = await import('../utils/dataLoader.js');
    const restaurant = getRestaurantByNameOrSlug(restaurantSlug);

    if (!restaurant) {
      return JSON.stringify({
        error: "Restaurant not found",
        suggestion: "Try searching with semantic_search_restaurants for similar names"
      });
    }

    // Prepare detailed info for the agent
    const detailInfo = {
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      summary: restaurant.summary,
      rating: restaurant.rating,
      price: restaurant.price,
      awards: {
        michelin_award: restaurant.michelin_award,
        nyttop100_rank: restaurant.nyttop100_rank
      },
      vibe: restaurant.yelp_review_highlights,
      reviews: {
        yelp: restaurant.yelp_review_highlights,
        reddit: restaurant.reddit
      },
      address: restaurant.address,
      phone: restaurant.telephone
    };

    if (detailType === "full") {
      // Return full details with restaurant array and map actions
      return JSON.stringify({
        ...detailInfo,
        restaurants: [restaurant],  // For backend to populate visibleRestaurants
        count: 1,
        mapActions: [
          {
            mapAction: 'highlightRestaurants',
            slugs: [restaurant.slug],
            count: 1
          }
        ]
      });
    }

    // Handle other types
    const typeMap = {
      vibe: {
        vibe: restaurant.yelp_review_highlights,
        count: 1
      },
      reviews: {
        yelp: restaurant.yelp_review_highlights,
        reddit: restaurant.reddit_mentions,
        count: 1
      },
      pricing: {
        price: restaurant.price,
        address: restaurant.address,
        phone: restaurant.telephone,
        count: 1
      }
    };

    const response = typeMap[detailType] || {
      ...detailInfo,
      restaurants: [restaurant],
      count: 1
    };

    // Only add map actions for 'full' detail type (explicit focus request)
    // For read-only queries (reviews, vibe, pricing), don't change map state
    const readOnlyTypes = ['reviews', 'vibe', 'pricing'];
    const shouldUpdateMap = detailType === 'full' || !readOnlyTypes.includes(detailType);

    if (shouldUpdateMap) {
      return JSON.stringify({
        ...response,
        mapActions: [
          {
            mapAction: 'highlightRestaurants',
            slugs: [restaurant.slug],
            count: 1
          }
        ]
      });
    }

    // Read-only query - return data without restaurants array or map actions
    // This prevents the frontend from treating read-only queries as map updates
    return JSON.stringify(response);
  }
});

/**
 * Tool 3: Semantic search using Pinecone RAG
 */
export const semanticSearchRestaurants = new DynamicStructuredTool({
  name: "semantic_search_restaurants",
  description: `AI-powered semantic search using vector embeddings (Pinecone + RAG).
Use for vibe/ambiance/dish queries: "cozy date spot", "best ramen", "great cocktails".`,

  schema: z.object({
    query: z.string().describe("Natural language query"),
    scopeToIsochrone: z.boolean().default(true).describe("If true and isochrone exists: search within isochrone base list. If false: search all 628 restaurants. Searches are NOT stacked - each query searches the same base."),
    topK: z.number().default(20).describe("Number of results to return"),
    preFilters: z.object({
      cuisines: z.array(z.string()).optional(),
      priceLevels: z.array(z.string()).optional(),
      neighborhoods: z.array(z.string()).optional(),
      minRating: z.number().optional()
    }).optional().describe("Optional filters to apply before semantic search")
  }),

  func: async ({ query, scopeToIsochrone, topK, preFilters }) => {
    try {
      console.log(`🔍 RAG Search: "${query}"`);

      // Get search pool (isochrone base or full dataset)
      const searchPool = await getScopedSearchPool(scopeToIsochrone);
      const visibleIds = searchPool ? searchPool.map(r => r.slug) : null;
      const baseIsochroneSlugs = visibleIds;

      // Perform RAG search (scoped to base list if isochrone exists)
      const result = await performRagSearch(query, preFilters || {}, topK, visibleIds);

      // Extract slugs for map actions
      const slugs = result.results.map(r => r.slug);

      // Build map actions - preserve isochrone if scoping
      const mapActions = [];

      // If scoping to isochrone, preserve the isochrone visualization
      if (scopeToIsochrone && baseIsochroneSlugs) {
        try {
          const { getCurrentAgentState } = await import('./agent.js');
          const state = getCurrentAgentState();
          if (state.isochroneParams?.polygon) {
            mapActions.push({
              mapAction: 'showIsochrone',
              polygon: state.isochroneParams.polygon,
              allRestaurantSlugs: baseIsochroneSlugs,
              fitBounds: false
            });
          }
        } catch (e) {
          console.warn("❌ Could not access isochrone params:", e);
        }
      }

      mapActions.push({
        mapAction: 'highlightRestaurants',
        slugs,
        count: slugs.length
      });

      return JSON.stringify({
        count: result.total_results,
        restaurants: result.results.slice(0, 10), // Return top 10 for display
        explanation: result.overall_explanation,
        fallback: result.fallback,
        query: result.query,
        // Auto-return map actions for visualization
        mapActions
      });
    } catch (error) {
      console.error('Semantic search error:', error);
      return JSON.stringify({
        error: error.message,
        query
      });
    }
  }
});

/**
 * Tool 4: Create isochrone
 */
export const createIsochrone = new DynamicStructuredTool({
  name: "create_isochrone",
  description: `Generate travel-time polygon from NYC location.
Use for "restaurants within 15 min walk from Grand Central".`,

  schema: z.object({
    location: z.string().describe("NYC address, neighborhood, or landmark"),
    travelTimeMinutes: z.number().min(5).max(60),
    mode: z.enum(["walking", "cycling", "transit", "driving"]).default("walking"),
    filters: z.object({
      cuisines: z.array(z.string()).optional(),
      priceLevels: z.array(z.string()).optional(),
      minRating: z.number().optional()
    }).optional().describe("Optional filters to apply to restaurants")
  }),

  func: async ({ location, travelTimeMinutes, mode, filters }) => {
    try {
      console.log(`🗺️  Isochrone: ${location}, ${travelTimeMinutes}min ${mode}`);

      // Step 1: Geocode location
      const geocoded = await geocodeAddress(location);
      if (!geocoded?.coordinates) {
        return JSON.stringify({ error: `Could not geocode: ${location}` });
      }

      // Step 2: Generate isochrone
      const isochrone = await generateIsochrone(
        geocoded.coordinates,
        travelTimeMinutes,
        mode
      );

      // Step 3: Filter restaurants within isochrone
      const { booleanPointInPolygon, point, polygon: turfPolygon } = await import('@turf/turf');
      const allRestaurants = loadRestaurantData();

      // Convert isochrone to Turf polygon if it isn't already (usually it's a GeoJSON Feature or Polygon)
      // generateIsochrone returns { polygon: { type: 'Feature', geometry: ... } }
      const poly = isochrone.polygon;

      const restaurantsInside = allRestaurants.filter(r => {
        // Ensure coordinates are numbers
        const lng = Number(r.longitude);
        const lat = Number(r.latitude);

        if (isNaN(lng) || isNaN(lat)) return false;

        const pt = point([lng, lat]);
        // Support both Feature<Polygon> and Polygon geometry
        const geometry = poly.geometry || poly;
        return booleanPointInPolygon(pt, poly); // booleanPointInPolygon handles Feature or Geometry
      });

      // Apply optional filters if provided (use shared filter logic)
      const filtered = filters
        ? applyFiltersManually(restaurantsInside, {
          cuisines: filters.cuisines || [],
          priceLevels: filters.priceLevels || [],
          neighborhoods: filters.neighborhoods || [],
          minRating: filters.minRating || 0,
          awards: []
        })
        : restaurantsInside;

      console.log(`🎯 Isochrone filtering: ${restaurantsInside.length} spatially matched → ${filtered.length} after filters`);

      // Extract slugs for map actions
      // NEW: Always return ALL restaurants in polygon (the "base list")
      const allSlugs = restaurantsInside.map(r => r.slug);
      const filteredSlugs = filtered.map(r => r.slug);

      return JSON.stringify({
        polygon: isochrone.polygon,
        allRestaurantSlugs: allSlugs,  // NEW: Base list for state tracking
        center: isochrone.center,
        location: geocoded.formatted_address,
        mode: isochrone.mode,
        travelTimeMinutes: isochrone.travel_time_minutes,
        fallback: isochrone.fallback || false,
        fallbackType: isochrone.fallback_type,
        restaurants: filtered.map(r => ({
          name: r.name,
          slug: r.slug,
          cuisine: r.cuisine,
          rating: r.yelp_rating,
          price: r.price,
          neighborhood: r.neighborhood
        })),
        count: filtered.length,
        // Auto-return map actions for visualization
        mapActions: [
          {
            mapAction: 'showIsochrone',
            polygon: isochrone.polygon,
            allRestaurantSlugs: allSlugs,  // NEW: Base list for frontend
            fitBounds: true
          },
          {
            mapAction: 'highlightRestaurants',
            slugs: filteredSlugs,  // Filtered subset for highlighting
            count: filteredSlugs.length
          }
        ]
      });
    } catch (error) {
      console.error('Isochrone creation error:', error);
      return JSON.stringify({ error: error.message });
    }
  }
});

/**
 * Tool 5: Find meeting point
 */
export const findMeetingPoint = new DynamicStructuredTool({
  name: "find_meeting_point",
  description: `Find restaurants reachable by 2+ people from different locations.
Supports intersection (both can reach), union (either can reach), exclusion (avoid areas).
Use for "I'm at Times Square, friend at LIC, what's between us?"`,

  schema: z.object({
    locations: z.array(z.object({
      address: z.string(),
      travelTimeMinutes: z.number().min(5).max(60),
      mode: z.enum(["walking", "cycling", "transit", "driving"]).default("walking")
    })).min(2).describe("Array of 2+ locations with travel times"),
    operation: z.enum(["intersection", "union", "exclusion"]).default("intersection")
  }),

  func: async ({ locations, operation }) => {
    try {
      console.log(`🤝 Meeting point: ${operation}, ${locations.length} locations`);

      const result = await generateMultiPartyIsochrone(locations, operation);

      if (!result.combinedPolygon) {
        return JSON.stringify({
          error: `No overlap found (${operation})`,
          restaurantCount: 0,
          locations: result.locations
        });
      }

      // Filter restaurants within the combined polygon
      const { booleanPointInPolygon, point } = await import('@turf/turf');
      const allRestaurants = loadRestaurantData();

      const poly = result.combinedPolygon;

      const restaurantsInside = allRestaurants.filter(r => {
        const lng = Number(r.longitude);
        const lat = Number(r.latitude);

        if (isNaN(lng) || isNaN(lat)) return false;

        const pt = point([lng, lat]);
        // Support both Feature<Polygon> and Polygon geometry
        return booleanPointInPolygon(pt, poly.geometry || poly);
      });

      // Calculate ALL restaurants within ANY individual polygon
      // This includes restaurants in pink, blue, and purple areas (for map region filtering)
      const allPolygonRestaurants = allRestaurants.filter(r => {
        const lng = Number(r.longitude);
        const lat = Number(r.latitude);

        if (isNaN(lng) || isNaN(lat)) return false;

        const pt = point([lng, lat]);

        // Check if restaurant is in ANY of the individual polygons
        return result.individualPolygons.some(polygon => {
          return booleanPointInPolygon(pt, polygon.geometry || polygon);
        });
      });

      console.log(`📍 Multi-party isochrone: ${allPolygonRestaurants.length} total in individual polygons, ${restaurantsInside.length} in ${operation} result`);

      // Extract slugs for map actions
      const slugs = restaurantsInside.map(r => r.slug);

      // Create map actions for multi-layer visualization
      const mapActions = [];

      // Add individual isochrone layers (one for each person)
      result.individualPolygons.forEach((polygon, index) => {
        mapActions.push({
          mapAction: 'showIsochroneLayer',
          polygon,
          layerId: `person-${index + 1}`,
          color: index === 0 ? 'pink' : 'blue', // Pink for first person, blue for second
          label: `${result.locations[index].address} (${result.locations[index].travelTimeMinutes} min)`
        });
      });

      // Add combined polygon (intersection/union/exclusion result)
      mapActions.push({
        mapAction: 'showIsochroneLayer',
        polygon: result.combinedPolygon,
        layerId: `${operation}-result`,
        color: 'purple', // Purple for the overlap/result
        label: `${operation} area`
      });

      // Highlight restaurants in the result area
      mapActions.push({
        mapAction: 'highlightRestaurants',
        slugs,
        count: slugs.length
      });

      // Fit map to show all polygons
      mapActions.push({
        mapAction: 'fitBounds',
        polygons: [...result.individualPolygons, result.combinedPolygon]
      });

      return JSON.stringify({
        polygon: result.combinedPolygon,
        individualPolygons: result.individualPolygons,
        operation,
        locations: result.locations,
        message: `Found ${operation} area for ${locations.length} locations`,

        // Operation result restaurants (for highlighting with pink markers and scoping)
        restaurants: restaurantsInside.map(r => ({
          name: r.name,
          slug: r.slug,
          cuisine: r.cuisine,
          rating: r.yelp_rating,
          price: r.price,
          neighborhood: r.neighborhood
        })),
        count: restaurantsInside.length,

        // All restaurants in ANY individual polygon (for map region filtering with grey markers)
        allPolygonRestaurants: allPolygonRestaurants.map(r => ({
          name: r.name,
          slug: r.slug,
          cuisine: r.cuisine,
          rating: r.yelp_rating,
          price: r.price,
          neighborhood: r.neighborhood
        })),
        allPolygonCount: allPolygonRestaurants.length,

        // Auto-return map actions for multi-layer visualization
        mapActions
      });
    } catch (error) {
      console.error('Meeting point error:', error);
      return JSON.stringify({ error: error.message });
    }
  }
});

/**
 * Tool 6: Get current results summary
 */
export const getCurrentResults = new DynamicStructuredTool({
  name: "get_current_results",
  description: `Get summary of the restaurants of interest (pink markers on map).
Use when user asks: "what did you find?", "show me results", "what kind of restaurants are these?", "tell me about the results".
Returns: total count, cuisine breakdown, price breakdown, average rating, and top 3 examples.`,

  schema: z.object({
    includeExamples: z.boolean().default(true)
  }),

  func: async ({ includeExamples }) => {
    // Access state from agent's module-level cache
    // Note: This requires importing getCurrentAgentState from agent.js
    // For now, use dynamic import to avoid circular dependency
    const { getCurrentAgentState } = await import('./agent.js');
    const state = getCurrentAgentState();
    const visible = state.visibleRestaurants || [];

    if (visible.length === 0) {
      return JSON.stringify({
        count: 0,
        message: "No restaurants currently highlighted. Try filtering or searching first."
      });
    }

    // Calculate stats
    const cuisines = {};
    const prices = {};
    visible.forEach(r => {
      cuisines[r.cuisine] = (cuisines[r.cuisine] || 0) + 1;
      prices[r.price] = (prices[r.price] || 0) + 1;
    });

    return JSON.stringify({
      count: visible.length,
      cuisineBreakdown: cuisines,
      priceBreakdown: prices,
      avgRating: (visible.reduce((sum, r) => sum + (r.rating || r.yelp_rating || 0), 0) / visible.length).toFixed(1),
      examples: includeExamples ? visible.slice(0, 3).map(r => r.name) : []
    });
  }
});

/**
 * Tool 7: Reset search state
 */
export const resetSearch = new DynamicStructuredTool({
  name: "reset_search",
  description: `Reset the search state, clear filters, and remove map visualizations.
Use when user says "start over", "clear map", "reset", "remove isochrones", or "restart".`,

  schema: z.object({
    reason: z.string().optional().describe("Reason for reset (optional)")
  }),

  func: async ({ reason }) => {
    // We don't need to do much here backend-side because the frontend
    // will detect this tool call and trigger the full reset.
    // However, we can also clear the backend state explicitly.
    try {
      const { resetAgentState } = await import('./agent.js');
      resetAgentState();
      return JSON.stringify({
        success: true,
        message: "Search state has been reset. Map and filters are cleared.",
        mapAction: "reset_all" // Signal to frontend
      });
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
});

export const tools = [
  filterRestaurants,
  getRestaurantDetails,
  semanticSearchRestaurants,
  createIsochrone,
  findMeetingPoint,
  getCurrentResults,
  resetSearch
];
