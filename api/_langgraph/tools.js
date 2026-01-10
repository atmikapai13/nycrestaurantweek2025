import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  loadRestaurantData,
  filterRestaurants as filterData,
  getRestaurantBySlug
} from '../_utils/dataLoader.js';
import { performRagSearch } from '../_lib/ragSearchLogic.js';
import { geocodeAddress } from '../_lib/geocodeLogic.js';
import { generateIsochrone, generateMultiPartyIsochrone } from '../_lib/isochroneLogic.js';

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
 * Get the filtered pool for search operations
 *
 * Returns array of restaurants to scope search to.
 * Priority:
 * 1. Use filterPool from frontend (if exists and not empty)
 * 2. Use isochrone base (if exists and scopeToIsochrone=true)
 * 3. Return null (signal to use all restaurants)
 *
 * Filter pool = base pool (all OR isochrone) + filter bar selections
 * Frontend pre-computes this, so backend just uses it directly
 */
async function getScopedSearchPool(scopeToIsochrone) {
  try {
    const { getCurrentAgentState } = await import('./agent.js');
    const state = getCurrentAgentState();
    const allRestaurants = loadRestaurantData();

    // CRITICAL FIX: When both filterPool AND isochrone exist, INTERSECT them
    // This handles the case where filterPool is from pre-isochrone state
    if (scopeToIsochrone &&
        state.isochroneParams?.allRestaurantSlugs?.length > 0 &&
        state.filterPool &&
        state.filterPool.length > 0) {

      // Intersect filterPool with isochrone boundary
      const isochroneSet = new Set(state.isochroneParams.allRestaurantSlugs);
      const intersectedSlugs = state.filterPool.filter(slug => isochroneSet.has(slug));

      const searchPool = allRestaurants.filter(r => intersectedSlugs.includes(r.slug));

      console.log(`🔗 Intersected filter pool (${state.filterPool.length}) with isochrone (${state.isochroneParams.allRestaurantSlugs.length}): ${searchPool.length} restaurants`);
      return searchPool;
    }

    // STEP 1: Check for filter pool ONLY (no isochrone active)
    if (state.filterPool && state.filterPool.length > 0) {
      const searchPool = allRestaurants.filter(r => state.filterPool.includes(r.slug));
      console.log(`🎯 Using filter pool: ${searchPool.length} restaurants`);
      return searchPool;
    }

    // STEP 2: Fall back to isochrone base only (if scopeToIsochrone=true)
    if (scopeToIsochrone && state.isochroneParams?.allRestaurantSlugs?.length > 0) {
      const searchPool = allRestaurants.filter(r =>
        state.isochroneParams.allRestaurantSlugs.includes(r.slug)
      );
      console.log(`🔍 Using isochrone base: ${searchPool.length} restaurants`);
      return searchPool;
    }

    // STEP 3: No scoping - use all restaurants
    console.log(`🌍 No filter pool or isochrone - using all restaurants`);
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
 * Tool 1: Get restaurant details
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
    const { getRestaurantByNameOrSlug } = await import('../_utils/dataLoader.js');
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
        reddit: restaurant.reddit,
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
  description: `AI-powered semantic search using vector embeddings.
Use for vibe/ambiance/dish queries: "cozy date spot", "best ramen", "cocktails".
Automatically scopes to filtered pool (respects filter bar + isochrone).`,

  schema: z.object({
    query: z.string().describe("Natural language search query"),
    scopeToIsochrone: z.boolean().default(true)
      .describe("If true: use filtered pool. If false: search all 628 restaurants."),
    topK: z.number().default(10).describe("Number of results to return")
    // REMOVED: preFilters parameter (filter bar handles this now)
  }),

  func: async ({ query, scopeToIsochrone, topK }) => {
    try {
      console.log(`🔍 Semantic search: "${query}"`);

      // Get filtered pool (uses filter pool from frontend)
      const searchPool = await getScopedSearchPool(scopeToIsochrone);
      const visibleIds = searchPool ? searchPool.map(r => r.slug) : null;

      // Perform RAG search (no preFilters - pool already filtered)
      const result = await performRagSearch(query, {}, topK, visibleIds);

      // Extract slugs for map actions
      const slugs = result.results.map(r => r.slug);

      // Build map actions (isochrone preservation handled automatically by agent middleware)
      const mapActions = [];

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
    travelTimeMinutes: z.number().min(5).max(60).default(15),
    mode: z.enum(["walking", "cycling", "transit", "driving"]).default("walking"),
    coordinates: z.array(z.number()).length(2).optional().describe("Optional [lon, lat] to skip geocoding (used when user picks from disambiguation options)"),
    filters: z.object({
      cuisines: z.array(z.string()).optional(),
      priceLevels: z.array(z.string()).optional(),
      minRating: z.number().optional()
    }).optional().describe("Optional filters to apply to restaurants")
  }),

  func: async ({ location, travelTimeMinutes, mode, coordinates, filters }) => {
    try {
      console.log(`🗺️  Isochrone: ${location}, ${travelTimeMinutes}min ${mode}`);

      // Step 1: Geocode location (or use provided coordinates)
      let finalCoordinates;
      let finalAddress;

      if (coordinates && Array.isArray(coordinates) && coordinates.length === 2) {
        // User picked from disambiguation - skip geocoding
        console.log(`📍 Using provided coordinates: [${coordinates[0]}, ${coordinates[1]}]`);
        finalCoordinates = coordinates;
        finalAddress = location; // Use location string as-is
      } else {
        // Normal geocoding flow
        const geocoded = await geocodeAddress(location);
        if (!geocoded?.coordinates) {
          return JSON.stringify({ error: `Could not geocode: ${location}` });
        }

        // Check if geocoding requires disambiguation
        if (geocoded.confidence === 'low' && geocoded.alternatives && geocoded.alternatives.length > 0) {
          console.log(`🤔 Location "${location}" is ambiguous - asking user to choose`);

          // Build options list with the primary result first
          const options = [
            {
              id: 1,
              label: `${geocoded.formatted_address} (${geocoded.neighborhood || 'unknown neighborhood'})`,
              coordinates: geocoded.coordinates,
              formatted_address: geocoded.formatted_address,
              neighborhood: geocoded.neighborhood
            },
            ...geocoded.alternatives.map((alt, index) => ({
              id: index + 2,
              label: alt.label,
              coordinates: alt.coordinates,
              formatted_address: alt.formatted_address,
              neighborhood: alt.neighborhood
            }))
          ];

          return JSON.stringify({
            needsDisambiguation: true,
            location,
            options,
            message: `I found ${options.length} locations matching "${location}". Which one did you mean?`
          });
        }

        finalCoordinates = geocoded.coordinates;
        finalAddress = geocoded.formatted_address;
      }

      // Step 2: Generate isochrone
      const isochrone = await generateIsochrone(
        finalCoordinates,
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
        location: finalAddress,
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
      coordinates: z.array(z.number()).length(2).optional()
        .describe("Optional [lon, lat] to skip geocoding (used when user picks from disambiguation options)"),
      travelTimeMinutes: z.number().min(5).max(60),
      mode: z.enum(["walking", "cycling", "transit", "driving"]).default("walking")
    })).min(2).describe("Array of 2+ locations with travel times"),
    operation: z.enum(["intersection", "union", "exclusion"]).default("intersection")
  }),

  func: async ({ locations, operation }) => {
    try {
      console.log(`🤝 Meeting point: ${operation}, ${locations.length} locations`);

      // STEP 1: Geocode all locations and check confidence BEFORE proceeding
      const geocodedLocations = await Promise.all(
        locations.map(async (loc) => {
          // If coordinates already provided (from disambiguation), skip geocoding
          if (loc.coordinates && Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
            console.log(`✅ Using pre-validated coordinates for "${loc.address}": [${loc.coordinates}]`);
            return {
              ...loc,
              geocoded: null,  // No geocoding needed
              coordinates: loc.coordinates,
              formatted_address: loc.address
            };
          }

          const geocoded = await geocodeAddress(loc.address);
          console.log(`Geocoding: "${loc.address}" → confidence: ${geocoded.confidence}`);

          return {
            ...loc,
            geocoded,  // Store full geocoding result (including confidence + alternatives)
            coordinates: geocoded.coordinates,
            formatted_address: geocoded.formatted_address
          };
        })
      );

      // STEP 2: Check if ANY location has low confidence
      const ambiguousLocations = geocodedLocations.filter(
        loc => loc.geocoded && loc.geocoded.confidence === 'low' &&
               loc.geocoded.alternatives?.length > 0
      );

      if (ambiguousLocations.length > 0) {
        // STOP: At least one location is ambiguous
        console.log(`🤔 ${ambiguousLocations.length} ambiguous location(s) - asking user to clarify`);

        // For simplicity: Handle FIRST ambiguous location only
        // (Sequential disambiguation: ask for location 1, then location 2, etc.)
        const firstAmbiguous = ambiguousLocations[0];
        const geocoded = firstAmbiguous.geocoded;

        const options = [
          {
            id: 1,
            label: `${geocoded.formatted_address} (${geocoded.neighborhood || 'unknown neighborhood'})`,
            coordinates: geocoded.coordinates,
            formatted_address: geocoded.formatted_address,
            neighborhood: geocoded.neighborhood
          },
          ...geocoded.alternatives.map((alt, index) => ({
            id: index + 2,
            label: alt.label,
            coordinates: alt.coordinates,
            formatted_address: alt.formatted_address,
            neighborhood: alt.neighborhood
          }))
        ];

        return JSON.stringify({
          needsDisambiguation: true,
          location: firstAmbiguous.address,
          locationIndex: geocodedLocations.indexOf(firstAmbiguous),  // Track which location is ambiguous
          operation,  // Store operation for resumption
          allLocations: locations,  // Store all locations for resumption
          options,
          message: `I found ${options.length} locations matching "${firstAmbiguous.address}". Which one did you mean?`
        });
      }

      // STEP 3: All locations are clear - proceed with isochrone generation
      // Extract coordinates (now validated)
      const validatedLocations = geocodedLocations.map(loc => ({
        address: loc.formatted_address,
        coordinates: loc.coordinates,
        travelTimeMinutes: loc.travelTimeMinutes,
        mode: loc.mode
      }));

      // Call the existing function but with pre-geocoded coordinates
      const result = await generateMultiPartyIsochrone(validatedLocations, operation);

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
  description: `Get a simple summary of currently highlighted restaurants (pink markers).
Use when user asks: "what did you find?", "show me results", "what are these restaurants?".
Returns: Simple count-based summary with witty observation.`,

  schema: z.object({}),  // No parameters needed

  func: async () => {
    const { getCurrentAgentState } = await import('./agent.js');
    const state = getCurrentAgentState();
    const visible = state.visibleRestaurants || [];

    if (visible.length === 0) {
      return JSON.stringify({
        count: 0,
        message: "No restaurants currently highlighted. Try searching or creating an isochrone first."
      });
    }

    // Simple stats for context generation
    const count = visible.length;

    // Get most common cuisine (for context)
    const cuisines = {};
    visible.forEach(r => {
      cuisines[r.cuisine] = (cuisines[r.cuisine] || 0) + 1;
    });
    const topCuisine = Object.entries(cuisines)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || '';

    // Determine context based on state
    let context = '';
    if (state.isochroneParams?.center) {
      context = 'in your selected area';
    } else if (state.filterPool && state.filterPool.length > 0) {
      context = 'matching your filters';
    } else {
      context = 'from your search';
    }

    return JSON.stringify({
      count,
      context,
      topCuisine,
      message: `We found ${count} restaurants ${context}. ${topCuisine ? `Leaning ${topCuisine}. ` : ''}Would you like to refine by vibe or ambiance?`
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
  getRestaurantDetails,
  semanticSearchRestaurants,
  createIsochrone,
  findMeetingPoint,
  getCurrentResults,
  resetSearch
];
