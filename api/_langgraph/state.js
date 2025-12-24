import { Annotation } from "@langchain/langgraph";

/**
 * Agent state - persists only within a single chat session
 * 
 * NOTE: In serverless, state is stored in request/response cycle only.
 * We'll use Vercel KV (Redis-like) or pass full state in requests.
 */

//Core conversation state
export const AgentState = Annotation.Root({
  messages: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  stepCount: Annotation({
    reducer: (current, increment) => current + (increment || 0),
    default: () => 0
  }),
  lastToolResults: Annotation({
    reducer: (_, newResults) => newResults,
    default: () => ({})
  }),

  //Restaurant Data State
  restaurantContext: Annotation({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({
      totalRestaurants: 0,
      allRestaurants: []
    })
  }),
  visibleRestaurants: Annotation({
    reducer: (_, newList) => newList,
    default: () => []
  }),

  //Spatial/Isochrone State
  isochroneParams: Annotation({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({
      polygon: null,
      allRestaurantSlugs: [],       // All restaurants in polygons (for BOTH display and filtering)
      center: null,
      mode: null,
      travelTimeMinutes: null,
      operation: null,              // "intersection", "union", "exclusion" (visual only)
      locations: null
    })
  }),
  isochroneLayers: Annotation({
    reducer: (_, newLayers) => newLayers,
    default: () => []
  }),

  // Map interaction State
  mapActions: Annotation({
    reducer: (_, newActions) => newActions,
    default: () => []
  }),
  highlightedRestaurants: Annotation({
    reducer: (_, newList) => newList,
    default: () => []
  })
});