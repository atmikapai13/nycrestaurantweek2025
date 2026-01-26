import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./Map.css";
import type { Restaurant } from "../types/restaurant";
import ChatInterface, { type ChatInterfaceHandle } from "./ChatInterface";
import { MapLegend } from "./MapLegend";
import { useMap, hasAnyAward, type IsochroneLayer, type GeocodedMarker } from "../contexts/MapContext";

// Set your Mapbox access token
mapboxgl.accessToken =
  "pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA";

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
  const markers = useRef<mapboxgl.Marker[]>([]);
  const markerElements = useRef<HTMLDivElement[]>([]);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);
  const geocodedPins = useRef<mapboxgl.Marker[]>([]); // Native teardrop pins for geocoded locations
  const pendingMarkerUpdate = useRef<number | null>(null); // Throttle zoom marker updates

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
    setUserLocation,
  } = useMap();

  // Refs for tracking previous isochrone states to prevent unnecessary re-renders
  const previousLayers = useRef<IsochroneLayer[]>([]);

  // Track selected restaurant for purple marker indicator
  // Now managed by MapContext.selectedRestaurant

  // Function to reset map state (isochrones and view)
  const resetMapView = () => {
    // Layer clearing is now handled by MapContext.clearAllLayers()
    // Clear selected restaurant
    setSelectedRestaurant(null);
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

  // Function to determine if device is mobile
  const isMobile = () => {
    return window.innerWidth <= 768 || "ontouchstart" in window;
  };

  // Function to calculate marker size based on zoom level and device
  const getMarkerSize = (
    baseSize: number,
    zoom: number,
    isMobileDevice: boolean
  ) => {
    // Scale smoothly based on zoom level
    // Smaller when zoomed out to reduce clustering
    const minZoom = 10;
    const maxZoom = 16;
    const minScale = isMobileDevice ? 0.45 : 0.5;
    const maxScale = isMobileDevice ? 1.5 : 1.2;

    const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    const t = (clampedZoom - minZoom) / (maxZoom - minZoom);
    const scale = minScale + t * (maxScale - minScale);

    return Math.round(baseSize * scale);
  };

  // Function to update all marker sizes (batched for performance)
  const updateMarkerSizes = () => {
    if (!map.current) return;

    const zoom = map.current.getZoom();
    const mobile = isMobile();

    // Batch all calculations first (reads) - prevents layout thrashing
    const updates: Array<{
      el: HTMLDivElement;
      size: number;
      isSelected: boolean;
      wrapper: HTMLElement | null;
    }> = [];

    markerElements.current.forEach((markerEl) => {
      if (markerEl && markerEl.style) {
        const baseSize = parseInt(markerEl.getAttribute("data-base-size") || "6");
        let newSize = getMarkerSize(baseSize, zoom, mobile);
        const isSelected = markerEl.getAttribute("data-is-selected") === "true";
        if (isSelected) {
          newSize = Math.round(newSize * 1.25);
        }
        updates.push({
          el: markerEl,
          size: newSize,
          isSelected,
          wrapper: markerEl.parentElement,
        });
      }
    });

    // Then apply all styles (writes) - no interleaved reads
    const padding = mobile ? "8px" : "6px";
    updates.forEach(({ el, size, isSelected, wrapper }) => {
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.border = isSelected ? "1.5px solid white" : "1px solid white";
      if (wrapper) {
        wrapper.style.padding = padding;
      }
    });
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
        '© <a href="https://atmikapai.dev/" target="_blank">Atmika Pai</a> © <a href="https://marauders.earth/" target="_blank">Marauders.Earth</a> © <a href="https://www.fultonring.com/" target="_blank">Fulton Ring</a> © <a href="https://urban.tech.cornell.edu/" target="_blank">Cornell Tech</a>',
    });

    // Add zoom event listener to update marker sizes (throttled with rAF)
    map.current.on("zoom", () => {
      if (pendingMarkerUpdate.current) {
        cancelAnimationFrame(pendingMarkerUpdate.current);
      }
      pendingMarkerUpdate.current = requestAnimationFrame(() => {
        updateMarkerSizes();
        pendingMarkerUpdate.current = null;
      });
    });

    // Add resize event listener for mobile detection
    window.addEventListener("resize", updateMarkerSizes);

    // Auto-detect user location and show on map
    map.current.on("load", () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;

            // Store user location in context for chat queries
            setUserLocation({ latitude, longitude });
            console.log(`📍 User location detected: ${latitude}, ${longitude}`);

            // Add user location marker (blue pulsing dot)
            const userLocationEl = document.createElement("div");
            userLocationEl.className = "user-location-marker";

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
      if (pendingMarkerUpdate.current) {
        cancelAnimationFrame(pendingMarkerUpdate.current);
      }
      if (map.current) {
        map.current.remove();
      }
      window.removeEventListener("resize", updateMarkerSizes);
    };
  }, []);

  // Collapse drawer to 8vh when USER interacts with map (zoom/pan) on mobile
  // Only triggers for user-initiated interactions (has originalEvent), not programmatic ones (flyTo, fitBounds)
  useEffect(() => {
    if (!map.current) return;

    const handleMapInteraction = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
      // Only collapse for user-initiated interactions (has originalEvent)
      // Programmatic changes (flyTo, fitBounds) don't have originalEvent
      if (!e.originalEvent) return;

      const isMobile = window.innerWidth <= 768;
      if (isMobile && drawerHeight !== 8) {
        setDrawerHeight(8);
      }
    };

    const mapInstance = map.current;
    mapInstance.on("dragstart", handleMapInteraction);
    mapInstance.on("zoomstart", handleMapInteraction);

    return () => {
      mapInstance.off("dragstart", handleMapInteraction);
      mapInstance.off("zoomstart", handleMapInteraction);
    };
  }, [drawerHeight, setDrawerHeight]);

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
          });
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
            "line-width": 2,
            "line-opacity": 0.4,
          },
        });
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

  // Update markers when restaurants change
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    markerElements.current = [];

    // Check if any filter modes are active
    const hasActiveFilters = favoritesActive || awardsActive;

    let restaurantsToRender = filteredRestaurants;

    if (hasActiveFilters) {
      // Filter mode active: apply OR logic to the already filtered pool
      restaurantsToRender = filteredRestaurants.filter((r) => {
        if (awardsActive && hasAnyAward(r)) return true;
        if (favoritesActive && favorites.includes(r.name)) return true;
        return false;
      });
    }

    // Sort restaurants so higher priority markers render last (on top)
    // Order: default (0) → awards (1) → favorites (2) → selected (3)
    const sortedRestaurants = [...restaurantsToRender].sort((a, b) => {
      const getPriority = (r: Restaurant) => {
        if (selectedRestaurant?.slug === r.slug) return 3;
        if (favorites.includes(r.name)) return 2;
        if (hasAnyAward(r)) return 1;
        return 0;
      };
      return getPriority(a) - getPriority(b);
    });

    // Render restaurants with coordinates
    sortedRestaurants.forEach((restaurant) => {
      if (restaurant.latitude && restaurant.longitude) {
        const isSelected = selectedRestaurant?.slug === restaurant.slug;
        const isFavorite = favorites.includes(restaurant.name);
        const isAwardWinner = hasAnyAward(restaurant);

        let markerColor = '#928f8e'  // Default grey
        let baseMarkerSize = 10;     // Base size for grey markers
        let zIndex = 0

        // COLOR PRIORITY: Pink (favorites) > Red (awards) > Grey (default)
        // Selected markers keep their original color and become teardrops
        if (isFavorite) {
          markerColor = "#ff67b2"; // Pink
          baseMarkerSize = 12;     // Larger size for favorites
          zIndex = isSelected ? 4 : 3;
        } else if (isAwardWinner) {
          markerColor = "#c81224"; // Red
          baseMarkerSize = 12;     // Same size as favorites
          zIndex = isSelected ? 4 : 2;
        } else if (isSelected) {
          zIndex = 4; // Grey teardrop when selected
        }

        let marker: mapboxgl.Marker;
        let markerEl: HTMLDivElement | null = null;

        if (isSelected) {
          // Selected restaurant: use native Mapbox teardrop marker with its original color
          marker = new mapboxgl.Marker({ color: markerColor, scale: 0.8 })
            .setLngLat([restaurant.longitude, restaurant.latitude])
            .addTo(map.current!);

          // Set high z-index for selected marker
          marker.getElement().style.zIndex = "5";
          marker.getElement().style.cursor = "pointer";

          // Add click handler to deselect
          marker.getElement().addEventListener("click", () => {
            setSelectedRestaurant(null);
          });
        } else {
          // Non-selected: use circular marker with click area wrapper
          const markerWrapper = document.createElement("div");
          markerWrapper.style.padding = isMobile() ? "10px" : "8px";
          markerWrapper.style.display = "flex";
          markerWrapper.style.alignItems = "center";
          markerWrapper.style.justifyContent = "center";
          markerWrapper.style.cursor = "pointer";

          // Create the actual marker element
          markerEl = document.createElement("div");
          markerEl.className = "restaurant-marker";
          markerEl.style.width = `${baseMarkerSize}px`;
          markerEl.style.height = `${baseMarkerSize}px`;
          markerEl.style.borderRadius = "50%";
          markerEl.style.backgroundColor = markerColor;
          markerEl.style.border = "1px solid white";
          markerEl.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
          markerEl.style.zIndex = zIndex.toString();

          // Add the marker to the wrapper
          markerWrapper.appendChild(markerEl);

          // Store base size for dynamic resizing
          markerEl.setAttribute("data-base-size", baseMarkerSize.toString());

          // Create marker using the wrapper
          marker = new mapboxgl.Marker(markerWrapper)
            .setLngLat([restaurant.longitude, restaurant.latitude])
            .addTo(map.current!);

          // Add click handler to the wrapper - show restaurant card in chat
          markerWrapper.addEventListener("click", () => {
            // Update selection state (triggers marker re-render)
            setSelectedRestaurant(restaurant);

            // Call onRestaurantSelect to trigger zoom/focus effect
            onRestaurantSelect(restaurant);

            // Add restaurant card to chat
            if (chatInterfaceRef.current) {
              chatInterfaceRef.current.addRestaurantCard(restaurant);
            }
          });
        }

        markers.current.push(marker);
        if (markerEl) {
          markerElements.current.push(markerEl);
        }
      }
    });

    // Update marker sizes after creating all markers
    updateMarkerSizes();
  }, [
    filteredRestaurants,
    onRestaurantSelect,
    selectedRestaurant,
    favoritesActive,
    awardsActive,
    favorites,
    setSelectedRestaurant,
    restaurantWeekActive,
  ]);

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

  // Render geocoded location pins (native Mapbox teardrop markers showing isochrone centers)
  useEffect(() => {
    if (!map.current) return;

    // Clear existing geocoded pins
    geocodedPins.current.forEach((pin) => pin.remove());
    geocodedPins.current = [];

    // Add new pins for each visible geocoded marker
    const visibleMarkers = geocodedMarkers.filter(
      (marker) => markerVisibilityMap.get(marker.id) !== false
    );

    visibleMarkers.forEach((marker) => {
      const pin = new mapboxgl.Marker({ color: "#625f60", scale: 0.8 })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map.current!);

      pin.getElement().style.zIndex = "10";
      geocodedPins.current.push(pin);
    });
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
