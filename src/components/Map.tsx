import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./Map.css";
import type { Restaurant } from "../types/restaurant";
import ChatInterface, { type ChatInterfaceHandle } from "./ChatInterface";
import { MapLegend } from "./MapLegend";
import { useMap, hasAnyAward, type IsochroneLayer, type GeocodedMarker } from "../contexts/MapContext";
import {
  addRestaurantLayers,
  CLICKABLE_RESTAURANT_LAYERS,
  FIRST_OVERLAY_LAYER,
  RESTAURANT_SOURCE,
  restaurantFeatures,
  setPlaces,
} from "./restaurantLayers";

// Set your Mapbox access token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Cuisine → emoji mapping (Cooking Mama style)
const CUISINE_EMOJI: Record<string, string> = {
  'Italian': '🍝',
  'Japanese / Sushi': '🍣',
  'French': '🥐',
  'Mexican': '🌮',
  'Steakhouse': '🥩',
  'Chinese': '🥡',
  'Korean': '🍱',
  'Indian': '🍛',
  'Thai': '🥘',
  'Seafood': '🦐',
  'Mediterranean': '🥙',
  'Greek': '🥙',
  'American (New)': '🍔',
  'American (Traditional)': '🍔',
  'Pizza': '🍕',
  'Vietnamese': '🥢',
  'Asian Fusion': '🥢',
  'Gastropub': '🍺',
  'Soul Food / Southern': '🍗',
  'Spanish': '🥘',
  'Middle Eastern': '🧆',
  'Caribbean': '🥥',
  'Brazilian': '🥩',
  'Turkish': '🧆',
  'Belgian': '🧇',
  'Eastern European': '🥟',
  'Ukrainian': '🥟',
  'Irish': '☘️',
  'British': '🫖',
  'Austrian': '🥨',
  'African': '🍲',
  'Cajun/Creole': '🦞',

  'Pan-Asian': '🥢',
  
  
  'Argentinian': '🥩',
  
  'Puerto Rican': '🍛',
  'Barbecue': '🍖',
  'Continental': '🍷',
  'Eclectic': '🍴',
};
const FALLBACK_EMOJI = '🍽️';


// Compare two GeoJSON polygons for equality
const arePolygonsEqual = (
  poly1:
    | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
    | null
    | undefined,
  poly2:
    | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
    | null
    | undefined
): boolean => {
  if (!poly1 && !poly2) return true;
  if (!poly1 || !poly2) return false;

  // Compare stringified versions for deep equality
  // This handles both Polygon and MultiPolygon geometries
  return JSON.stringify(poly1) === JSON.stringify(poly2);
};

interface MapProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onToggleFavorite?: (restaurantName: string) => void;
  onFilterChange: (filterType: string, values: string[]) => void;
  onResetAll?: () => void;
  mapResetRef?: React.MutableRefObject<(() => void) | null>;
}

export default function Map({
  onRestaurantSelect,
  onToggleFavorite,
  onFilterChange,
  onResetAll,
  mapResetRef,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const restaurantsBySlug = useRef<globalThis.Map<string, Restaurant>>(new globalThis.Map()); // for layer clicks
  const restaurantLayersReady = useRef(false);
  // Pushes the latest restaurants/favorites/selection into the restaurant layer source
  const renderRestaurants = useRef<() => void>(() => {});
  // Pushes the visible searched places (character portraits) into the places layer
  const renderPlaces = useRef<() => void>(() => {});

  // Use MapContext for state and actions
  const {
    allRestaurants,
    filteredRestaurants,
    favorites,
    favoritesActive,
    awardsActive,
    isochroneLayers,
    layerVisibilityMap,
    selectedRestaurant,
    setSelectedRestaurant,
    restaurantWeekActive,
    drawerHeight,
    setDrawerHeight,
    geocodedMarkers,
    markerVisibilityMap,
    clearGeocodedMarkers,
    recommendedSlugs,
    setRecommendedSlugs,
    setUserLocation,
  } = useMap();

  // Refs for tracking previous isochrone states to prevent unnecessary re-renders
  const previousLayers = useRef<IsochroneLayer[]>([]);
  const selectedRestaurantRef = useRef(selectedRestaurant); // Avoid stale closures in click handlers
  const onRestaurantSelectRef = useRef(onRestaurantSelect);
  onRestaurantSelectRef.current = onRestaurantSelect;

  // Keep selectedRestaurantRef in sync (avoids stale closures in click handlers)
  useEffect(() => {
    selectedRestaurantRef.current = selectedRestaurant;
  }, [selectedRestaurant]);

  // Function to reset map state (isochrones and view)
  const resetMapView = () => {
    // Layer clearing is now handled by MapContext.clearAllLayers()
    // Clear selected restaurant
    setSelectedRestaurant(null);
    // Clear recommended slugs
    setRecommendedSlugs([]);
    // Clear geocoded location pins
    clearGeocodedMarkers();

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768;

    // Use EXACT same values as initial map setup (lines 212-221)
    const center = isMobile ? [-73.992, 40.727] : [-74.014, 40.737];
    const zoom = isMobile ? 12.2 : 12.58; 
    const pitch = 45;
    const bearing = 0;

    // Reset map to default view (mobile or desktop)
    if (map.current) {
      // Create a small bounding box around the center point
      // This allows us to use fitBounds with padding (same as isochrone operations)
      const lng = center[0];
      const lat = center[1];
      const offset = 0.05; // Small offset to create bounds (~5km)

      const bounds = new mapboxgl.LngLatBounds(
        [lng - offset, lat - offset], // Southwest
        [lng + offset, lat + offset] // Northeast
      );

      // Use fitBounds with padding to account for chat interface
      // This matches the padding used in isochrone operations (lines 367-372)
      // Force exact zoom level to match initial map setup
      
      map.current.fitBounds(bounds, {
        padding: isMobile
          ? { top: 40, bottom: 350, left: 20, right: 20 } // Mobile: pad bottom for drawer (40vh ≈ 320px)
          : { top: 100, bottom: 100, left: 480, right: 100 }, // Desktop: pad left for chat panel
        pitch,
        bearing,
        maxZoom: zoom, // Force exact zoom level
        minZoom: zoom, // Force exact zoom level
        duration: 1500,
      });
    }
  };

  // Set the reset function to the ref so App.tsx can call it
  useEffect(() => {
    if (mapResetRef) {
      mapResetRef.current = resetMapView;
    }
  }, [mapResetRef]);

  // Implement onMapFocus handler for semantic search results
  const handleMapFocus = (restaurantSlugs: string[]) => {
    // Recommended restaurants are drawn as red markers
    setRecommendedSlugs(restaurantSlugs);

    // Filter allRestaurants to only include the semantic search results
    const focusedRestaurants = allRestaurants.filter((r) =>
      restaurantSlugs.includes(r.slug)
    );

    

    // DON'T set isochrone region here - that should only be set by actual isochrone queries
    // This function is called by RAG/semantic/filter results, which should highlight within existing isochrone

    // Use onFilterChange to set a special "Semantic Search" filter
    // This will trigger App.tsx to update filteredRestaurants
    onFilterChange(
      "Semantic Search Results",
      focusedRestaurants.map((r) => r.slug)
    );

    // Fit map to bounds with responsive padding
    if (map.current && focusedRestaurants.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();

      focusedRestaurants.forEach((restaurant) => {
        if (restaurant.longitude && restaurant.latitude) {
          bounds.extend([restaurant.longitude, restaurant.latitude]);
        }
      });

      const isMobileView = window.innerWidth <= 768;

     

      map.current.fitBounds(bounds, {
        padding: isMobileView
          ? { top: 80, bottom: 320, left: 20, right: 20 } // Mobile: pad bottom for drawer
          : { top: 100, bottom: 100, left: 480, right: 100 }, // Desktop: pad left for chat panel
        maxZoom: 16, // High zoom limit for neighborhood focus
        duration: 1500,
      });
    }
  };

  useEffect(() => {
    if (!mapContainer.current) return;

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768;

    // Mobile-specific viewport: shifted south to account for 40% drawer at bottom
    const mobileCenter: [number, number] = [-73.988, 40.727]; // Shifted south to show lower Manhattan
    const mobileZoom = 11.8;
    const mobilePitch = 45;
    const mobileBearing = 0;

    // Desktop viewport
    const desktopCenter: [number, number] = [-74.030, 40.757];
    const desktopZoom = 11.8;
    const desktopPitch = 45;
    const desktopBearing = 0;

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/atmikapai13/cmhdmnool00ai01qw6qz79zqu", // Custom style
      center: isMobile ? mobileCenter : desktopCenter,
      zoom: isMobile ? mobileZoom : desktopZoom,
      pitch: isMobile ? mobilePitch : desktopPitch,
      bearing: isMobile ? mobileBearing : desktopBearing,
      minZoom: 10, // Prevent zooming out to the whole world
      customAttribution:
        '© <a href="https://atmikapai.dev/" target="_blank">Atmika</a> © <a href="https://marauders.earth/" target="_blank">Marauders</a>',
    });

    const mapInstance = map.current;

    // Restaurant markers live in map layers (see restaurantLayers.ts)
    mapInstance.on("load", () => {
      const emojis = [...new Set([...Object.values(CUISINE_EMOJI), FALLBACK_EMOJI])];
      addRestaurantLayers(mapInstance, emojis, isMobile);
      restaurantLayersReady.current = true;
      renderRestaurants.current();
      renderPlaces.current();
    });

    // Click a restaurant to select it; click it again to deselect
    mapInstance.on("click", CLICKABLE_RESTAURANT_LAYERS, (e) => {
      const slug = e.features?.[0]?.properties?.slug as string | undefined;
      const restaurant = slug ? restaurantsBySlug.current.get(slug) : undefined;
      if (!restaurant) return;
      if (selectedRestaurantRef.current?.slug === restaurant.slug) {
        setSelectedRestaurant(null);
      } else {
        setSelectedRestaurant(restaurant);
        onRestaurantSelectRef.current(restaurant);
        chatInterfaceRef.current?.addRestaurantCard(restaurant);
      }
    });
    mapInstance.on("mouseenter", CLICKABLE_RESTAURANT_LAYERS, () => {
      mapInstance.getCanvas().style.cursor = "pointer";
    });
    mapInstance.on("mouseleave", CLICKABLE_RESTAURANT_LAYERS, () => {
      mapInstance.getCanvas().style.cursor = "";
    });

    // Auto-detect user location and show on map
    map.current.on("load", () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;

            // Store user location in context for chat queries
            setUserLocation({ latitude, longitude });
            console.log(`📍 User location detected: ${latitude}, ${longitude}`);

            // Add user location marker (blue dot with pulse)
            const userLocationEl = document.createElement("div");
            userLocationEl.className = "user-location-marker";
            userLocationEl.setAttribute("aria-label", "Your location");

            const pulseRing = document.createElement("div");
            pulseRing.className = "pulse-ring";
            userLocationEl.appendChild(pulseRing);

            const dot = document.createElement("div");
            dot.className = "user-location-dot";
            userLocationEl.appendChild(dot);

            new mapboxgl.Marker({ element: userLocationEl })
              .setLngLat([longitude, latitude])
              .addTo(map.current!);
          },
          (error) => {
            console.log("Geolocation not available:", error.message);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    });

    return () => {
      restaurantLayersReady.current = false;
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);



  // Handle multi-layer isochrone visualization (from MapContext)
  useEffect(() => {
    if (!map.current) return;

    

    // Compare layer arrays (check length and each layer's polygon)
    const layersEqual =
      isochroneLayers.length === previousLayers.current.length &&
      isochroneLayers.every((layer, i) =>
        arePolygonsEqual(layer.polygon, previousLayers.current[i]?.polygon)
      );

    const mapInstance = map.current;
    if (layersEqual) {
      
      // If visibility changed but layers didn't, update visibility for all existing layers
      isochroneLayers.forEach((layer) => {
        const fillLayerId = `isochrone-fill-${layer.id}`;
        const outlineLayerId = `isochrone-outline-${layer.id}`;

        // Check per-layer visibility (default to true if not set)
        const isVisible = layerVisibilityMap.get(layer.id) !== false;

        if (mapInstance.getLayer(fillLayerId)) {
          mapInstance.setLayoutProperty(
            fillLayerId,
            "visibility",
            isVisible ? "visible" : "none"
          );
        }
        if (mapInstance.getLayer(outlineLayerId)) {
          mapInstance.setLayoutProperty(
            outlineLayerId,
            "visibility",
            isVisible ? "visible" : "none"
          );
        }
      });
      return;
    }

    // Update ref for next comparison
    previousLayers.current = isochroneLayers;

    // Wait for map to load before adding layers
    const updateLayers = () => {
      // Remove ALL existing isochrone layers (both old and new format)
      // This includes: messageId-person-X, messageId-intersection, messageId-single-isochrone
      const existingLayers = mapInstance
        .getStyle()
        .layers.filter((l: mapboxgl.Layer) => l.id.startsWith("isochrone-"));

      existingLayers.forEach((layer: mapboxgl.Layer) => {
        if (mapInstance.getLayer(layer.id)) {
          
          mapInstance.removeLayer(layer.id);
        }
      });

      // Remove ALL existing isochrone sources
      const existingSources = Object.keys(
        mapInstance.getStyle().sources || {}
      ).filter((s: string) => s.startsWith("isochrone-"));

      existingSources.forEach((source: string) => {
        if (mapInstance.getSource(source)) {
          
          mapInstance.removeSource(source);
        }
      });

      // If no layers to add (empty array), just return after cleanup
      if (isochroneLayers.length === 0) return;

      // Separate base layers (person1, person2, etc.) from result layers (intersection, union)
      // Layer IDs are now: messageId-person-1, messageId-person-2, messageId-intersection
      const baseLayers = isochroneLayers.filter((l) =>
        l.id.includes("-person-")
      );
      const resultLayers = isochroneLayers.filter(
        (l) => !l.id.includes("-person-")
      );

     

      // Add layers in order: base layers first, then result layers (so result is on top)
      const layersToAdd = [...baseLayers, ...resultLayers];

      layersToAdd.forEach((layer) => {
        const sourceId = `isochrone-${layer.id}`;
        const fillLayerId = `isochrone-fill-${layer.id}`;
        const outlineLayerId = `isochrone-outline-${layer.id}`;

        

        // Normalize polygon to GeoJSON Feature format for Mapbox
        const polygonFeature: GeoJSON.Feature<
          GeoJSON.Polygon | GeoJSON.MultiPolygon
        > =
          "type" in layer.polygon && layer.polygon.type === "Feature"
            ? (layer.polygon as GeoJSON.Feature<
                GeoJSON.Polygon | GeoJSON.MultiPolygon
              >)
            : {
                type: "Feature",
                geometry: layer.polygon as
                  | GeoJSON.Polygon
                  | GeoJSON.MultiPolygon,
                properties: {},
              };

        // Add GeoJSON source
        mapInstance.addSource(sourceId, {
          type: "geojson",
          data: polygonFeature,
        });

        // Add fill layer with solid color
        // Insert isochrones beneath the place portraits and restaurant markers
        const beneathRestaurants = mapInstance.getLayer(FIRST_OVERLAY_LAYER) ? FIRST_OVERLAY_LAYER : undefined;
        if (layer.opacity > 0) {
          mapInstance.addLayer({
            id: fillLayerId,
            type: "fill",
            source: sourceId,
            layout: {
              visibility:
                layerVisibilityMap.get(layer.id) !== false ? "visible" : "none",
            },
            paint: {
              "fill-color": layer.color,
              "fill-opacity": layer.opacity,
            },
          }, beneathRestaurants);
        }

        // Add outline layer
        mapInstance.addLayer({
          id: outlineLayerId,
          type: "line",
          source: sourceId,
          layout: {
            visibility:
              layerVisibilityMap.get(layer.id) !== false ? "visible" : "none",
          },
          paint: {
            "line-color": layer.strokeColor,
            "line-width": 1,
            "line-opacity": 0.4,
          },
        }, beneathRestaurants);
      });

      // ... (existing fitBounds logic) ...
      // Fit map bounds to ALL polygons
      if (isochroneLayers.length > 0) {
        
        const bounds = new mapboxgl.LngLatBounds();

        isochroneLayers.forEach((layer) => {
          try {
            // Extract the actual geometry from Feature or use polygon directly
            const geometry =
              "type" in layer.polygon && layer.polygon.type === "Feature"
                ? (
                    layer.polygon as GeoJSON.Feature<
                      GeoJSON.Polygon | GeoJSON.MultiPolygon
                    >
                  ).geometry
                : (layer.polygon as GeoJSON.Polygon | GeoJSON.MultiPolygon);

            if (
              geometry.type === "Polygon" &&
              geometry.coordinates &&
              geometry.coordinates[0]
            ) {
              geometry.coordinates[0].forEach((coord: GeoJSON.Position) => {
                bounds.extend(coord as [number, number]);
              });
            } else if (
              geometry.type === "MultiPolygon" &&
              geometry.coordinates
            ) {
              geometry.coordinates.forEach((polygon: GeoJSON.Position[][]) => {
                if (polygon[0]) {
                  polygon[0].forEach((coord: GeoJSON.Position) => {
                    bounds.extend(coord as [number, number]);
                  });
                }
              });
            }
          } catch (error) {
            
          }
        });

        // Fit bounds with responsive padding
        if (!bounds.isEmpty()) {
          const isMobileView = window.innerWidth <= 768;

          // For "between us" queries (3+ layers including intersection), zoom in closer
          // For single/double isochrone, use conservative zoom
          const maxZoomLevel = isMobileView ? 17 : (isochroneLayers.length >= 3 ? 15.5 : 16);

          mapInstance.fitBounds(bounds, {
            padding: isMobileView
              ? { top: 40, bottom: 350, left: 20, right: 20 }  // Mobile: pad bottom for drawer (40vh ≈ 320px)
              : { top: 100, bottom: 100, left: 480, right: 100 }, // Desktop: pad left for chat panel
            maxZoom: maxZoomLevel,
            duration: 1500, // Smooth 1.2s animation
          });
        }
      }
    };

    if (mapInstance.isStyleLoaded()) {
      updateLayers();
    } else {
      mapInstance.once("load", updateLayers);
    }
  }, [isochroneLayers, layerVisibilityMap]);

  // Update the restaurant layer when restaurants, filters, favorites, or selection change
  useEffect(() => {
    // Favorites / award toggles show only matching restaurants (OR logic)
    const restaurantsToRender =
      favoritesActive || awardsActive
        ? filteredRestaurants.filter(
            (r) => (awardsActive && hasAnyAward(r)) || (favoritesActive && favorites.includes(r.name))
          )
        : filteredRestaurants;

    renderRestaurants.current = () => {
      const source = map.current?.getSource(RESTAURANT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      if (!restaurantLayersReady.current || !source) return; // the map's load handler renders once ready
      restaurantsBySlug.current = new globalThis.Map(restaurantsToRender.map((r) => [r.slug, r]));
      source.setData(
        restaurantFeatures(restaurantsToRender, {
          favorites,
          selectedSlug: selectedRestaurant?.slug ?? null,
          recommended: new Set(recommendedSlugs),
          emojiFor: (r) => CUISINE_EMOJI[r.cuisine] || FALLBACK_EMOJI,
        })
      );
    };
    renderRestaurants.current();
  }, [filteredRestaurants, favoritesActive, awardsActive, favorites, selectedRestaurant, restaurantWeekActive, recommendedSlugs]);

  // Zoom to selected restaurant when it changes
  useEffect(() => {
    if (!map.current || !selectedRestaurant) return;

    const { latitude, longitude } = selectedRestaurant;

    if (latitude && longitude) {
      const currentZoom = map.current.getZoom();
      const isMobileView = window.innerWidth <= 768;

      // Check if restaurant is visible in current viewport
      const bounds = map.current.getBounds();
      const isInViewport = bounds.contains([longitude, latitude]);

      // Skip flyTo only if zoomed in past threshold AND restaurant is already visible
      const skipZoomThreshold = isMobileView ? 13.5 : 15;
      if (currentZoom > skipZoomThreshold && isInViewport) return;

      // Keep current zoom if already zoomed in, otherwise zoom to target (13 for mobile, 14.1 for desktop)
      const minZoom = isMobileView ? 13.8 : 14.1;
      const targetZoom = currentZoom > minZoom ? currentZoom : minZoom;

      // Smooth fly to the restaurant location
      map.current.flyTo({
        center: [longitude, latitude],
        zoom: targetZoom,
        pitch: 45,
        bearing: map.current.getBearing(), // Keep current bearing
        duration: 2500, // Smooth 1.8s animation
        essential: true, // This animation is essential with respect to prefers-reduced-motion
        padding: isMobileView
          ? { top: 10, bottom: 450, left: 20, right: 20 } // Mobile: pad bottom for drawer
          : { top: 100, bottom: 100, left: 480, right: 100 }, // Desktop: pad left for chat panel
      });
    }
  }, [selectedRestaurant]);

  // Render searched places' character portraits (a map layer beneath the restaurant markers)
  useEffect(() => {
    const visibleMarkers = geocodedMarkers.filter((marker) => markerVisibilityMap.get(marker.id) !== false);
    renderPlaces.current = () => {
      if (!map.current || !restaurantLayersReady.current) return; // the map's load handler renders once ready
      setPlaces(map.current, visibleMarkers);
    };
    renderPlaces.current();
  }, [geocodedMarkers, markerVisibilityMap]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {/* Chat Interface (overlays map region) */}
      <ChatInterface
        ref={chatInterfaceRef}
        onRestaurantSelect={onRestaurantSelect}
        onMapFocus={handleMapFocus}
        onResetAll={onResetAll}
        onToggleFavorite={onToggleFavorite}
      />

      {/* Map Legend */}
      <MapLegend />
    </div>
  );
}
