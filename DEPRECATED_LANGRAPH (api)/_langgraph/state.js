import { Annotation } from "@langchain/langgraph";

/**
 * Agent state - purpose is to maintain context persistency across multiple tools calls within a conversation
 * persists only within a single chat session 
 */

//Core conversation state
export const AgentState = Annotation.Root({
  // full chat history 
  messages: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),

  // number of tool calls made
  stepCount: Annotation({ 
    reducer: (current, increment) => current + (increment || 0),
    default: () => 0
  }),

  //metadata from most recent tool execution
  lastToolResults: Annotation({
    reducer: (_, newResults) => newResults,
    default: () => ({})
  }),

  //Restaurant Data State

  //total count and full dataset
  restaurantContext: Annotation({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({
      totalRestaurants: 0,
      allRestaurants: []
    })
  }),

  //currently highlighted/filtered restaurants with pink markers -- REPLACED on each tool call
  visibleRestaurants: Annotation({
    reducer: (_, newList) => newList,
    default: () => []
  }),

  //Spatial/Isochrone State

  //active isochrone data (polygon, center, travel time mode)
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

  // multi-party isochrone visualization data
  isochroneLayers: Annotation({
    reducer: (_, newLayers) => newLayers,
    default: () => []
  }),

  // commands sent to frontend ie highlightRestaurants, showIsochrone
  mapActions: Annotation({
    reducer: (_, newActions) => newActions,
    default: () => []
  }),

  // Filter Pool State (from frontend filter bar)
  filterPool: Annotation({
    reducer: (_, newPool) => newPool,  // Replace reducer - computed fresh each time
    default: () => []
  })
});