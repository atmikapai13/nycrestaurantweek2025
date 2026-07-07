import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { Restaurant } from "../types/restaurant";
import restaurantData from "../data/WorldCup2026/worldcup2026.json";
import { point, booleanPointInPolygon } from "@turf/turf";

export type GeoJSONGeometry =
  | Feature<Polygon | MultiPolygon>
  | Polygon
  | MultiPolygon;

// Deal-category toggle PILLS surfaced in the FilterBar. `key` matches the values
// written into `deal_tags` by src/utils/WorldCup2026/5_TagDeals.py; `label` is
// the pill text. These are cross-cutting attributes (each ANDs when active).
// Order here is the display order.
export const DEAL_TAG_FILTERS: { key: string; label: string }[] = [
  { key: "bars", label: "Bars" },
  { key: "specialty_cocktails", label: "Specialty Cocktails" },
  { key: "burger_beer", label: "Beer & Burger" },
  { key: "tacos", label: "Tacos" },
  { key: "grab_n_go", label: "Grab-n-Go" },
];

const DEAL_TAG_KEYS = new Set(DEAL_TAG_FILTERS.map((f) => f.key));

// "$26 Offer" dropdown options — the deal TYPE ("what does my $26 buy?").
// food_only / meal_drink_combo / drink_only are mutually exclusive; together with
// desserts they cover ~95% of $26 offers. Selecting more than one ORs them (see
// filter logic). The attribute pills (Bars, Specialty Cocktails, …) cross-cut
// these, so e.g. "Drinks only" × "Specialty Cocktails" = the Venn intersection.
// Emoji prefixes double as a map legend — they match the marker emojis set by
// getDealEmoji() in Map.tsx (Meal 🍱 / Meal + Drink 🤑 / Drinks 🍻 / Dessert 🍰).
export const OFFER_26_OPTIONS: { value: string; label: string }[] = [
  { value: "food_only", label: "🍱 Meal" },
  { value: "meal_drink_combo", label: "🤑 Meal + Drink" },
  { value: "drink_only", label: "🍻 Drink" },
  { value: "desserts", label: "🍫 Dessert" },
];

// "Awards" dropdown — recognition badges (a handful of venues each). OR together.
export const AWARDS_OPTIONS: { value: string; label: string }[] = [
  { value: "michelin", label: "Michelin" },
  { value: "nyt", label: "NYT Top 100" },
];

export const hasAnyAward = (restaurant: Restaurant): boolean => {
  const hasMichelin =
    restaurant.michelin_award &&
    ["ONE_STAR", "TWO_STARS", "THREE_STARS", "BIB_GOURMAND"].includes(
      restaurant.michelin_award
    );
  const hasNYT = Boolean(
    restaurant.nyttop100_rank && restaurant.nyttop100_rank !== ""
  );
  return hasMichelin || hasNYT;
};

export interface IsochroneLayer {
  id: string;
  polygon: GeoJSONGeometry;
  label: string;
  color: string;
  strokeColor: string;
  opacity: number;
  messageId?: string; // Track which message created this layer
}

export interface GeocodedMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string; // The query or formatted address
  color: string; // Marker color to match isochrone
  characterImage: string; // Character image path (e.g. "/characters/collette.png")
  messageId?: string; // Track which message created this marker (for visibility toggling)
}

interface MapContextType {
  // Data state
  allRestaurants: Restaurant[];
  filteredRestaurants: Restaurant[];

  // Filter state
  activeFilters: Record<string, string[]>;
  legendFilters: string[];
  searchTerm: string;
  favorites: string[];
  favoritesActive: boolean;
  restaurantWeekActive: boolean;
  hasMenuActive: boolean;
  awardsActive: boolean;
  highReviewCountActive: boolean;

  // Filter actions
  setActiveFilters: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  setLegendFilters: React.Dispatch<React.SetStateAction<string[]>>;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setFavorites: React.Dispatch<React.SetStateAction<string[]>>;
  setFavoritesActive: React.Dispatch<React.SetStateAction<boolean>>;
  setRestaurantWeekActive: React.Dispatch<React.SetStateAction<boolean>>;
  setHasMenuActive: React.Dispatch<React.SetStateAction<boolean>>;
  setAwardsActive: React.Dispatch<React.SetStateAction<boolean>>;
  setHighReviewCountActive: React.Dispatch<React.SetStateAction<boolean>>;

  // Layer state
  isochroneLayers: IsochroneLayer[];
  layerVisibilityMap: Map<string, boolean>;

  // Layer actions
  addLayers: (layers: IsochroneLayer[], messageId: string) => void;
  removeLayers: (messageId: string) => void;
  toggleLayerVisibility: (layerIds: string[]) => void;
  clearAllLayers: () => void;

  // Selected restaurant
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurant: (restaurant: Restaurant | null) => void;

  // Isochrone region slugs (restaurants inside visible polygons)
  isochroneRegionSlugs: string[] | null;
  setIsochroneRegionSlugs: (slugs: string[] | null) => void;

  // Filter pool slugs (for passing to chat API)
  filterPoolSlugs: string[];

  // Mobile filter bar expanded state (for coordinating UI elements)
  filterBarExpanded: boolean;
  setFilterBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // True while the onboarding card (which points at Refine) is showing
  onboardingRefineHint: boolean;
  setOnboardingRefineHint: React.Dispatch<React.SetStateAction<boolean>>;

  // One-shot signal: set true to ask the onboarding to fully dismiss itself
  // (e.g. tapping Refine/Search on the card that points at them)
  onboardingDismissRequested: boolean;
  setOnboardingDismissRequested: React.Dispatch<React.SetStateAction<boolean>>;

  // Mobile search toggle expanded state (for coordinating UI elements)
  searchExpanded: boolean;
  setSearchExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // True while the Mapbox attribution "(i)" popup is expanded (mobile)
  attributionExpanded: boolean;
  setAttributionExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // Geocoded location markers (teardrop pins)
  geocodedMarkers: GeocodedMarker[];
  markerVisibilityMap: Map<string, boolean>;
  addGeocodedMarker: (marker: Omit<GeocodedMarker, "id">) => void;
  clearGeocodedMarkers: () => void;

  // User's current location (from browser geolocation)
  userLocation: { latitude: number; longitude: number } | null;
  setUserLocation: (location: { latitude: number; longitude: number } | null) => void;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export function MapProvider({ children }: { children: React.ReactNode }) {
  // Data state
  const [allRestaurants] = useState<Restaurant[]>(
    restaurantData as unknown as Restaurant[]
  );

  // Filter state
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(
    {}
  );
  const [legendFilters, setLegendFilters] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesActive, setFavoritesActive] = useState(false);
  const [restaurantWeekActive, setRestaurantWeekActive] = useState(false);
  const [hasMenuActive, setHasMenuActive] = useState(false);
  const [awardsActive, setAwardsActive] = useState(false);
  const [highReviewCountActive, setHighReviewCountActive] = useState(false);

  // Layer state
  const [isochroneLayers, setIsochroneLayers] = useState<IsochroneLayer[]>([]);
  const [layerVisibilityMap, setLayerVisibilityMap] = useState<
    Map<string, boolean>
  >(new Map());
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<Restaurant | null>(null);
  const [isochroneRegionSlugs, setIsochroneRegionSlugs] = useState<
    string[] | null
  >(null);

  // Mobile filter bar expanded state (starts expanded on desktop, collapsed on mobile)
  const [filterBarExpanded, setFilterBarExpanded] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 768 : true
  );

  // True while the onboarding card (which points at Refine) is showing
  const [onboardingRefineHint, setOnboardingRefineHint] = useState(false);

  // One-shot signal to fully dismiss onboarding from outside the component
  const [onboardingDismissRequested, setOnboardingDismissRequested] = useState(false);

  // Mobile search toggle expanded state
  const [searchExpanded, setSearchExpanded] = useState(false);

  // True while the Mapbox attribution "(i)" popup is expanded (mobile)
  const [attributionExpanded, setAttributionExpanded] = useState(false);

  // Geocoded location markers
  const [geocodedMarkers, setGeocodedMarkers] = useState<GeocodedMarker[]>([]);
  const [markerVisibilityMap, setMarkerVisibilityMap] = useState<Map<string, boolean>>(new Map());

  // User's current location (from browser geolocation)
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // 1. Calculate which restaurants are inside ANY visible isochrone
  const visibleIsochroneSlugs = useMemo(() => {
    const visiblePolygons: Array<Polygon | MultiPolygon> = [];

    isochroneLayers.forEach((layer) => {
      if (layerVisibilityMap.get(layer.id) !== false && layer.polygon) {
        const geom =
          "type" in layer.polygon && layer.polygon.type === "Feature"
            ? (layer.polygon as Feature<Polygon | MultiPolygon>).geometry
            : (layer.polygon as Polygon | MultiPolygon);
        visiblePolygons.push(geom);
      }
    });

    if (visiblePolygons.length === 0) return null;

    return allRestaurants
      .filter((r) => {
        const lng = Number(r.longitude);
        const lat = Number(r.latitude);
        if (isNaN(lng) || isNaN(lat)) return false;
        const pt = point([lng, lat]);
        return visiblePolygons.some((poly) => booleanPointInPolygon(pt, poly));
      })
      .map((r) => r.slug);
  }, [allRestaurants, isochroneLayers, layerVisibilityMap]);

  // Sync visibleIsochroneSlugs to isochroneRegionSlugs
  useEffect(() => {
    setIsochroneRegionSlugs(visibleIsochroneSlugs);
  }, [visibleIsochroneSlugs]);

  // 2. Apply filters to restaurants
  const filteredRestaurants = useMemo(() => {
    // Start with either all restaurants or just those in the isochrone region
    let filtered = isochroneRegionSlugs
      ? allRestaurants.filter((r) => isochroneRegionSlugs.includes(r.slug))
      : allRestaurants;

    // Apply search filter
    if (searchTerm.trim()) {
      filtered = filtered.filter(
        (restaurant) =>
          restaurant.name &&
          restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply ribbon filters (dropdowns)
    Object.entries(activeFilters).forEach(([filterType, values]) => {
      if (values.length > 0) {
        filtered = filtered.filter((restaurant) => {
          // Deal-category toggle pills (Bars, Watch the Game, etc.) — each ANDs.
          if (DEAL_TAG_KEYS.has(filterType)) {
            return restaurant.deal_tags?.includes(filterType) ?? false;
          }
          switch (filterType) {
            // $26 Offer dropdown: selected sub-types OR together
            case "$26 Offer":
              return values.some((tag) => restaurant.deal_tags?.includes(tag));
            // Awards dropdown: selected badges OR together
            case "Awards":
              return values.some((a) => {
                if (a === "michelin")
                  return Boolean(
                    restaurant.michelin_award && restaurant.michelin_award !== ""
                  );
                if (a === "nyt")
                  return Boolean(
                    restaurant.nyttop100_rank && restaurant.nyttop100_rank !== ""
                  );
                return false;
              });
            case "Cuisine":
              if (!restaurant.cuisine) return false;
              return values.some(
                (value) =>
                  restaurant.cuisine === value ||
                  restaurant.cuisine.toLowerCase().includes(value.toLowerCase())
              );
            // World Cup promo toggles (filter active when values non-empty)
            case "Limited Edition Cup":
              return restaurant.limited_edition_cup === true;
            case "$26 Offers":
              return restaurant.has_26_offer === true;
            case "Meal Types":
              return (
                restaurant.meal_types &&
                Array.isArray(restaurant.meal_types) &&
                values.some((meal) => restaurant.meal_types?.includes(meal))
              );
            case "Price":
              return values.includes(
                (restaurant as any).price ?? restaurant.price_range
              );
            case "Participation Weeks":
              return (
                restaurant.participation_weeks &&
                Array.isArray(restaurant.participation_weeks) &&
                values.some((week) =>
                  restaurant.participation_weeks?.includes(week)
                )
              );
            case "Yelp Rating": {
              const rating = (restaurant as any).yelp_rating as
                | number
                | undefined;
              if (typeof rating !== "number") return false;
              const thresholds = values
                .map((v) => parseFloat(v))
                .filter((n) => !Number.isNaN(n));
              if (thresholds.length === 0) return true;
              const minThreshold = Math.min(...thresholds);
              return rating >= minThreshold;
            }
            case "Collections":
            case "Vibes":
              return (
                restaurant.collections &&
                values.some((collection) =>
                  restaurant.collections.includes(collection)
                )
              );
            case "Badges":
              return values.some((badge) => {
                switch (badge) {
                  case "michelin":
                    return (
                      restaurant.michelin_award &&
                      ["ONE_STAR", "TWO_STARS", "THREE_STARS"].includes(
                        restaurant.michelin_award
                      )
                    );
                  case "bib":
                  case "bib_gourmand":
                    return restaurant.michelin_award === "BIB_GOURMAND";
                  case "nyt":
                  case "nyt_top_100":
                    return Boolean(restaurant.nyttop100_rank);
                  default:
                    return false;
                }
              });
            case "Semantic Features": {
              const highlights =
                restaurant.yelp_review_highlights?.toLowerCase() || "";
              if (!highlights) return false;
              return values.some(
                (keyword) =>
                  keyword && highlights.includes(keyword.toLowerCase())
              );
            }
            case "Semantic Search Results":
              return values.some((slug) => restaurant.slug === slug);
            default:
              return true;
          }
        });
      }
    });

    // Apply toggle filters (pills)
    if (restaurantWeekActive) {
      filtered = filtered.filter(
        (r) =>
          r.meal_types && Array.isArray(r.meal_types) && r.meal_types.length > 0
      );
    }
    if (favoritesActive) {
      filtered = filtered.filter((r) => favorites.includes(r.name));
    }
    if (hasMenuActive) {
      filtered = filtered.filter((r) => r.menu_url && r.menu_url.trim() !== "");
    }
    if (awardsActive) {
      filtered = filtered.filter((r) => {
        const hasMichelin =
          r.michelin_award &&
          ["ONE_STAR", "TWO_STARS", "THREE_STARS", "BIB_GOURMAND"].includes(
            r.michelin_award
          );
        const hasNYT = Boolean(r.nyttop100_rank && r.nyttop100_rank !== "");
        return hasMichelin || hasNYT;
      });
    }
    if (highReviewCountActive) {
      filtered = filtered.filter((r) => {
        const reviewCount = (r as any).yelp_review_count as number | undefined;
        return typeof reviewCount === "number" && reviewCount >= 500;
      });
    }

    // Apply legend filters
    if (legendFilters.length > 0) {
      filtered = filtered.filter((restaurant) => {
        return legendFilters.some((filterType) => {
          switch (filterType) {
            case "michelin":
              return (
                restaurant.michelin_award &&
                ["ONE_STAR", "TWO_STARS", "THREE_STARS"].includes(
                  restaurant.michelin_award
                )
              );
            case "bib":
              return restaurant.michelin_award === "BIB_GOURMAND";
            case "nyt":
              return restaurant.nyttop100_rank;
            case "offer26":
              return restaurant.has_26_offer === true;
            case "cup":
              return restaurant.limited_edition_cup === true;
            case "regular":
              return (
                !restaurant.michelin_award &&
                !restaurant.nyttop100_rank &&
                !restaurant.has_26_offer &&
                !restaurant.limited_edition_cup
              );
            default:
              return false;
          }
        });
      });
    }

    return filtered;
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    searchTerm,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    awardsActive,
    highReviewCountActive,
    legendFilters,
    favorites,
  ]);

  // Compute filter pool slugs for chat API
  const filterPoolSlugs = useMemo(() => {
    return filteredRestaurants.map((r) => r.slug);
  }, [filteredRestaurants]);

  const addLayers = useCallback(
    (newLayers: IsochroneLayer[], messageId: string) => {
      console.log(
        `🗺️ MapContext: Adding ${newLayers.length} layers for message ${messageId}`
      );

      // Tag each layer with the messageId
      const taggedLayers = newLayers.map((layer) => ({
        ...layer,
        messageId,
      }));

      setIsochroneLayers((prev) => {
        // Remove any existing layers from this message first
        const filtered = prev.filter((l) => l.messageId !== messageId);
        return [...filtered, ...taggedLayers];
      });

      // Initialize visibility to true for new layers
      setLayerVisibilityMap((prev) => {
        const newMap = new Map(prev);
        taggedLayers.forEach((layer) => {
          if (!newMap.has(layer.id)) {
            newMap.set(layer.id, true);
          }
        });
        return newMap;
      });
    },
    []
  );

  const removeLayers = useCallback((messageId: string) => {
    console.log(`🗺️ MapContext: Removing layers for message ${messageId}`);

    // First, collect the layer IDs to remove
    const layerIdsToRemove: string[] = [];
    setIsochroneLayers((prev) => {
      // Find layers to remove and collect their IDs
      prev.forEach((l) => {
        if (l.messageId === messageId) {
          layerIdsToRemove.push(l.id);
        }
      });
      // Return filtered array
      return prev.filter((l) => l.messageId !== messageId);
    });

    // Clean up visibility map using the collected IDs
    setLayerVisibilityMap((prev) => {
      const newMap = new Map(prev);
      layerIdsToRemove.forEach((id) => newMap.delete(id));
      return newMap;
    });
  }, []);

  const toggleLayerVisibility = useCallback((layerIds: string[]) => {
    console.log(
      `🗺️ MapContext: Toggling visibility for ${layerIds.length} layers`
    );

    // Find messageIds of layers being toggled
    const messageIds = new Set<string>();
    isochroneLayers.forEach((layer) => {
      if (layerIds.includes(layer.id) && layer.messageId) {
        messageIds.add(layer.messageId);
      }
    });

    setLayerVisibilityMap((prev) => {
      const newMap = new Map(prev);

      // Check if all layers are currently visible
      const allVisible = layerIds.every((id) => newMap.get(id) !== false);

      // Toggle: if all visible, hide them; if any hidden, show all
      layerIds.forEach((id) => {
        newMap.set(id, !allVisible);
      });

      console.log(
        `🗺️ MapContext: Set layers to ${!allVisible ? "visible" : "hidden"}`
      );

      // Also toggle geocoded markers with matching messageIds
      if (messageIds.size > 0) {
        setMarkerVisibilityMap((prevMarkers) => {
          const newMarkerMap = new Map(prevMarkers);
          geocodedMarkers.forEach((marker) => {
            if (marker.messageId && messageIds.has(marker.messageId)) {
              newMarkerMap.set(marker.id, !allVisible);
            }
          });
          console.log(
            `📍 MapContext: Set markers to ${!allVisible ? "visible" : "hidden"}`
          );
          return newMarkerMap;
        });
      }

      return newMap;
    });
  }, [isochroneLayers, geocodedMarkers]);

  const clearAllLayers = useCallback(() => {
    console.log("🗺️ MapContext: Clearing all layers");
    setIsochroneLayers([]);
    setLayerVisibilityMap(new Map());
    setMarkerVisibilityMap(new Map());
    setIsochroneRegionSlugs(null);
  }, []);

  const addGeocodedMarker = useCallback(
    (marker: Omit<GeocodedMarker, "id">) => {
      const id = `geocode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      console.log(`📍 MapContext: Adding geocoded marker at ${marker.label}`);
      setGeocodedMarkers((prev) => [...prev, { ...marker, id }]);
    },
    []
  );

  const clearGeocodedMarkers = useCallback(() => {
    console.log("📍 MapContext: Clearing geocoded markers");
    setGeocodedMarkers([]);
  }, []);

  return (
    <MapContext.Provider
      value={{
        allRestaurants,
        filteredRestaurants,
        activeFilters,
        setActiveFilters,
        legendFilters,
        setLegendFilters,
        searchTerm,
        setSearchTerm,
        favorites,
        setFavorites,
        favoritesActive,
        setFavoritesActive,
        restaurantWeekActive,
        setRestaurantWeekActive,
        hasMenuActive,
        setHasMenuActive,
        awardsActive,
        setAwardsActive,
        highReviewCountActive,
        setHighReviewCountActive,
        isochroneLayers,
        layerVisibilityMap,
        addLayers,
        removeLayers,
        toggleLayerVisibility,
        clearAllLayers,
        selectedRestaurant,
        setSelectedRestaurant,
        isochroneRegionSlugs,
        setIsochroneRegionSlugs,
        filterPoolSlugs,
        filterBarExpanded,
        setFilterBarExpanded,
        onboardingRefineHint,
        setOnboardingRefineHint,
        onboardingDismissRequested,
        setOnboardingDismissRequested,
        searchExpanded,
        setSearchExpanded,
        attributionExpanded,
        setAttributionExpanded,
        geocodedMarkers,
        markerVisibilityMap,
        addGeocodedMarker,
        clearGeocodedMarkers,
        userLocation,
        setUserLocation,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMap() {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error("useMap must be used within a MapProvider");
  }
  return context;
}
