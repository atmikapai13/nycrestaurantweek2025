import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./Map.css";
import type { Restaurant } from "../types/restaurant";
import { useMap, hasAnyAward, type IsochroneLayer, type GeocodedMarker } from "../contexts/MapContext";
import { asset } from "../utils/asset";
import RestaurantCard from "./RestaurantCard";
import { useIsMobile } from "@/hooks/use-mobile";

// Set your Mapbox access token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Marker emoji maps to the $26 Offer breakdown (what your $26 buys). Venues with
// only the collectible (no $26 deal) show the World Cup trophy. Priority handles
// the lone overlap — a dessert shop that also has a meal deal reads as dessert.
const getDealEmoji = (restaurant: Restaurant): string => {
  const tags = restaurant.deal_tags ?? [];
  if (restaurant.has_26_offer) {
    if (tags.includes("desserts")) return "🍰";
    if (tags.includes("meal_drink_combo")) return "🤑"; // Meal + Drink
    if (tags.includes("food_only")) return "🍱"; // Meal
    if (tags.includes("drink_only")) return "🍻"; // Drinks only
    return "🍽️"; // $26 offer with no specific type
  }
  if (tags.includes("desserts")) return "🍰"; // dessert shop, collectible only
  return "🏆"; // collectible cup only — no $26 deal
};

// Emoji teardrop background color (Cooking Mama beige cream)
const EMOJI_BG_COLOR = '#FFFAEA';

// Zoom threshold for emoji mode (mobile shows earlier)
const EMOJI_ZOOM_THRESHOLD_DESKTOP = 15;
const EMOJI_ZOOM_THRESHOLD_MOBILE = 14.5;

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
  const geocodedPins = useRef<mapboxgl.Marker[]>([]); // Native teardrop pins for geocoded locations
  const pendingMarkerUpdate = useRef<number | null>(null); // Throttle zoom marker updates
  const currentMarkerMode = useRef<'dot' | 'emoji'>('dot'); // Track marker display mode
  const markerElBySlug = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map()); // slug → marker element
  const recommendedSlugs = useRef<Set<string>>(new Set()); // Remi-suggested restaurants

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
  const selectedRestaurantRef = useRef(selectedRestaurant); // Avoid stale closures in click handlers

  // Desktop: restaurant card renders as a Mapbox popup anchored above the marker.
  const isMobileViewport = useIsMobile();
  const cardPopup = useRef<mapboxgl.Popup | null>(null);
  const popupContainer = useMemo(() => document.createElement("div"), []);

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
    recommendedSlugs.current.clear();
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
    // Directly flip recommended markers to emoji teardrops
    restaurantSlugs.forEach((slug) => {
      const el = markerElBySlug.current.get(slug);
      if (el) {
        el.classList.add("emoji-mode");
        el.style.width = "36px";
        el.style.height = "42px";
        el.style.borderRadius = "";
        el.style.backgroundColor = EMOJI_BG_COLOR;
        const dotColor = el.getAttribute("data-dot-color") || "#928f8e";
        el.style.border = dotColor === "#928f8e" ? "" : `2.5px solid ${dotColor}`;
        const emojiSpan = el.querySelector(".marker-emoji") as HTMLElement | null;
        if (emojiSpan) emojiSpan.style.display = "";
        // Bring to front
        const mapboxContainer = el.closest('.mapboxgl-marker') as HTMLElement | null;
        if (mapboxContainer) mapboxContainer.style.zIndex = "5";
      }
    });

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
    // Tuned so dots read at the zoomed-out default (~10.5) without blobbing together
    const minScale = isMobileDevice ? 0.7 : 0.75;
    const maxScale = isMobileDevice ? 1.6 : 1.3;

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
    const emojiThreshold = mobile ? EMOJI_ZOOM_THRESHOLD_MOBILE : EMOJI_ZOOM_THRESHOLD_DESKTOP;
    const shouldBeEmoji = zoom >= emojiThreshold;

    // Update mode ref
    currentMarkerMode.current = shouldBeEmoji ? 'emoji' : 'dot';

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
    updates.forEach(({ el, size, wrapper }) => {
      if (shouldBeEmoji) {
        // Emoji teardrop mode (zoomed in past threshold). Selection no longer
        // forces this — the card pops up above the marker instead.
        el.classList.add("emoji-mode");
        el.classList.remove("emoji-selected");
        el.style.width = "36px";
        el.style.height = "42px";
        el.style.borderRadius = "";  // Let CSS handle it
        el.style.backgroundColor = EMOJI_BG_COLOR;
        const dotColor = el.getAttribute("data-dot-color") || "#928f8e";
        el.style.border = dotColor === "#928f8e" ? "" : `2.5px solid ${dotColor}`;
        // Show emoji
        const emojiSpan = el.querySelector(".marker-emoji") as HTMLElement | null;
        if (emojiSpan) emojiSpan.style.display = "";
        if (wrapper) {
          wrapper.style.padding = "4px";
        }
      } else {
        // Dot mode (non-selected, zoom < 15)
        const dotColor = el.getAttribute("data-dot-color") || "#928f8e";
        el.classList.remove("emoji-mode");
        el.classList.remove("emoji-selected");
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = "50%";
        el.style.backgroundColor = dotColor;
        el.style.border = "1px solid white";
        // Hide emoji
        const emojiSpan = el.querySelector(".marker-emoji") as HTMLElement | null;
        if (emojiSpan) emojiSpan.style.display = "none";
        if (wrapper) {
          wrapper.style.padding = padding;
        }
      }
    });
  };

  useEffect(() => {
    if (!mapContainer.current) return;

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768;

    // Fallback center when geolocation is unavailable/denied or the user is
    // outside NYC: Manhattan Midtown (~Bryant Park).
    const MIDTOWN: [number, number] = [-73.984, 40.754];

    // Mobile-specific viewport: shifted south so Midtown sits above the 40% drawer
    const mobileCenter: [number, number] = [MIDTOWN[0], MIDTOWN[1] - 0.127];
    const mobileZoom = 10.0;
    const mobilePitch = 45;
    const mobileBearing = 0;

    // Desktop viewport
    const desktopCenter: [number, number] = MIDTOWN;
    const desktopZoom = 10.50;
    const desktopPitch = 30;
    const desktopBearing = 0;

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/atmikapai13/cmlbhu73z001e01rz83jfgvaa", // Custom style
      center: isMobile ? mobileCenter : desktopCenter,
      zoom: isMobile ? mobileZoom : desktopZoom,
      pitch: isMobile ? mobilePitch : desktopPitch,
      bearing: isMobile ? mobileBearing : desktopBearing,
      minZoom: 10, // Prevent zooming out to the whole world
      customAttribution:
        '© <a href="https://atmikapai.dev/" target="_blank">Atmika</a> © <a href="https://marauders.earth/" target="_blank">Marauders</a>',
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

            // Store user location for the sidebar's "closest to you" list and
            // chat queries. The map itself stays on the Midtown fallback — we
            // don't recenter, to avoid a jarring jump once geolocation resolves.
            setUserLocation({ latitude, longitude });
            console.log(`📍 User location detected: ${latitude}, ${longitude}`);

            // Add user location marker (Alfredo with blue pulse)
            const userLocationEl = document.createElement("div");
            userLocationEl.className = "user-location-marker";

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
      if (pendingMarkerUpdate.current) {
        cancelAnimationFrame(pendingMarkerUpdate.current);
      }
      if (map.current) {
        map.current.remove();
      }
      window.removeEventListener("resize", updateMarkerSizes);
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
            "line-width": 1,
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

  // Update markers when restaurants change (NOT on selection change)
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    markerElements.current = [];
    markerElBySlug.current.clear();

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

    // All markers look identical (plain black), so no priority sorting needed.
    const sortedRestaurants = restaurantsToRender;

    // Render restaurants with coordinates
    sortedRestaurants.forEach((restaurant) => {
      if (restaurant.latitude && restaurant.longitude) {
        // Favorited restaurants get a pink marker so they stand out; others black.
        const markerColor = favorites.includes(restaurant.name) ? "#FF69B4" : "#000000";
        const baseMarkerSize = 10;
        const zIndex = 0;

        let marker: mapboxgl.Marker;
        let markerEl: HTMLDivElement | null = null;

        // All restaurants use custom DOM markers (emoji-capable)
        const markerWrapper = document.createElement("div");
        markerWrapper.style.padding = isMobile() ? "10px" : "8px";
        markerWrapper.style.display = "flex";
        markerWrapper.style.alignItems = "center";
        markerWrapper.style.justifyContent = "center";
        markerWrapper.style.cursor = "pointer";

        // Determine deal emoji ($26 Offer breakdown, or trophy for collectible-only)
        const dealEmoji = getDealEmoji(restaurant);

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

        // Store data attributes for emoji mode
        markerEl.setAttribute("data-deal-emoji", dealEmoji);
        markerEl.setAttribute("data-dot-color", markerColor);
        markerEl.setAttribute("data-slug", restaurant.slug);

        // Add emoji span (hidden by default, shown at zoom ≥ 15)
        const emojiSpan = document.createElement("span");
        emojiSpan.className = "marker-emoji";
        emojiSpan.textContent = dealEmoji;
        emojiSpan.style.display = "none";
        markerEl.appendChild(emojiSpan);

        // Add star rating badge arcing above marker (hidden, shown on selection)
        if (restaurant.yelp_rating) {
          const starCount = Math.round(restaurant.yelp_rating);
          const starBadge = document.createElement("div");
          starBadge.className = "marker-star-badge";
          // Position each star along an arc
          const arcRadius = 30;
          const totalArc = Math.min(starCount * 30, 140); // degrees of arc
          const startAngle = 90 + totalArc / 2; // start from left side
          for (let i = 0; i < starCount; i++) {
            const star = document.createElement("span");
            star.className = "marker-star";
            star.textContent = '⭐';
            const angle = startAngle - (starCount > 1 ? i * (totalArc / (starCount - 1)) : 0);
            const rad = (angle * Math.PI) / 180;
            const x = arcRadius * Math.cos(rad);
            const y = -arcRadius * Math.sin(rad);
            star.style.transform = `translate(${x}px, ${y}px)`;
            starBadge.appendChild(star);
          }
          markerWrapper.appendChild(starBadge);
        }

        // Add the marker to the wrapper
        markerWrapper.appendChild(markerEl);

        // Store base size for dynamic resizing
        markerEl.setAttribute("data-base-size", baseMarkerSize.toString());

        // Create marker using the wrapper
        marker = new mapboxgl.Marker(markerWrapper)
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .addTo(map.current!);

        // Add click handler (uses ref to avoid stale closure)
        markerWrapper.addEventListener("click", () => {
          if (selectedRestaurantRef.current?.slug === restaurant.slug) {
            // Deselect
            setSelectedRestaurant(null);
          } else {
            // Select — the card now renders as a floating overlay on the map
            // (driven by selectedRestaurant in App), not in the chat panel.
            setSelectedRestaurant(restaurant);
            onRestaurantSelect(restaurant);
          }
        });

        markers.current.push(marker);
        if (markerEl) {
          markerElements.current.push(markerEl);
          markerElBySlug.current.set(restaurant.slug, markerEl);
        }
      }
    });

    // Update marker sizes after creating all markers
    updateMarkerSizes();
  }, [
    filteredRestaurants,
    onRestaurantSelect,
    favoritesActive,
    awardsActive,
    favorites,
    setSelectedRestaurant,
    restaurantWeekActive,
  ]);

  // Handle selection styling without recreating markers
  useEffect(() => {
    // Clear previous selection and reset z-index
    markerElBySlug.current.forEach((el) => {
      el.removeAttribute("data-is-selected");
      const mapboxContainer = el.closest('.mapboxgl-marker') as HTMLElement | null;
      if (mapboxContainer) {
        mapboxContainer.style.zIndex = "";
        // Hide star badge
        const starBadge = mapboxContainer.querySelector('.marker-star-badge') as HTMLElement | null;
        if (starBadge) starBadge.style.display = "none";
      }
    });

    // Apply selection to new marker
    if (selectedRestaurant) {
      const el = markerElBySlug.current.get(selectedRestaurant.slug);
      if (el) {
        el.setAttribute("data-is-selected", "true");
        const mapboxContainer = el.closest('.mapboxgl-marker') as HTMLElement | null;
        if (mapboxContainer) {
          mapboxContainer.style.zIndex = "10";
          // Show star badge
          const starBadge = mapboxContainer.querySelector('.marker-star-badge') as HTMLElement | null;
          if (starBadge) starBadge.style.display = "block";
        }
      }
    }

    // Re-run marker sizing to apply/remove emoji-selected styling
    updateMarkerSizes();
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
      const el = document.createElement("div");
      el.className = "isochrone-character-marker";

      const img = document.createElement("img");
      img.src = marker.characterImage;
      img.alt = marker.label;
      el.appendChild(img);

      const pin = new mapboxgl.Marker({ element: el })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map.current!);

      pin.getElement().style.zIndex = "10";
      geocodedPins.current.push(pin);
    });
  }, [geocodedMarkers, markerVisibilityMap]);

  // Anchor the desktop card popup above the selected marker (tracks pan/zoom,
  // auto-flips near edges). Mobile uses the bottom-sheet drawer instead.
  useEffect(() => {
    if (!map.current || isMobileViewport || !selectedRestaurant) return;
    const lng = Number(selectedRestaurant.longitude);
    const lat = Number(selectedRestaurant.latitude);
    if (Number.isNaN(lng) || Number.isNaN(lat)) return;

    // The filter bar floats over the top of the map; Mapbox's auto-anchor only
    // considers the map container, so a high marker would render the card upward
    // and collide with the filters. If anchoring above would intrude into the
    // filter bar, anchor below the marker instead (render downward).
    const offset = 16;
    const margin = 12;
    const point = map.current.project([lng, lat]);
    const mapRect = mapContainer.current?.getBoundingClientRect();
    const mapTop = mapRect?.top ?? 0;
    const mapBottom = mapRect?.bottom ?? window.innerHeight;
    const markerViewportY = mapTop + point.y;
    const filterBar = document.querySelector(".filter-bar-container");
    const filterBottom = filterBar?.getBoundingClientRect().bottom ?? 90;
    const estimatedPopupHeight = popupContainer.offsetHeight || 400;
    const wouldOverlapFilters =
      markerViewportY - offset - estimatedPopupHeight < filterBottom;
    const anchor = wouldOverlapFilters ? "top" : "bottom";

    // Cap the card to the space available in the chosen direction so a tall card
    // is never clipped off-screen — it scrolls internally instead. (Anchor "top"
    // renders the card below the marker; "bottom" renders it above.)
    const availableHeight =
      anchor === "top"
        ? mapBottom - markerViewportY - offset - margin
        : markerViewportY - offset - filterBottom - margin;
    const card = popupContainer.querySelector<HTMLElement>(".restaurant-card");
    if (card) {
      card.style.maxHeight = `${Math.max(220, Math.floor(availableHeight))}px`;
      card.style.overflowY = "auto";
      card.style.overscrollBehavior = "contain";
    }

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "340px",
      offset,
      anchor,
      className: "restaurant-popup",
    })
      .setLngLat([lng, lat])
      .setDOMContent(popupContainer)
      .addTo(map.current);
    cardPopup.current = popup;

    return () => {
      popup.remove();
      if (cardPopup.current === popup) cardPopup.current = null;
    };
  }, [selectedRestaurant, isMobileViewport, popupContainer]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {!isMobileViewport &&
        selectedRestaurant &&
        createPortal(
          <RestaurantCard
            restaurant={selectedRestaurant}
            onClose={() => setSelectedRestaurant(null)}
            isFavorited={favorites.includes(selectedRestaurant.name)}
            onToggleFavorite={() => onToggleFavorite?.(selectedRestaurant.name)}
          />,
          popupContainer
        )}
    </div>
  );
}
