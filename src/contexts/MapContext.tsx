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
import restaurantData from "../data/FinalData.json";
import { point, booleanPointInPolygon } from "@turf/turf";

export type GeoJSONGeometry =
  | Feature<Polygon | MultiPolygon>
  | Polygon
  | MultiPolygon;

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
  highlightedActive: boolean;
  awardsActive: boolean;
  highReviewCountActive: boolean;
  highlightedRestaurantIds: Set<string>;

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
  setHighlightedActive: React.Dispatch<React.SetStateAction<boolean>>;
  setAwardsActive: React.Dispatch<React.SetStateAction<boolean>>;
  setHighReviewCountActive: React.Dispatch<React.SetStateAction<boolean>>;
  setHighlightedRestaurantIds: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;

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

  // Drawer height state (for coordinating UI elements)
  drawerHeight: number;
  setDrawerHeight: React.Dispatch<React.SetStateAction<number>>;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export function MapProvider({ children }: { children: React.ReactNode }) {
  // Data state
  const [allRestaurants] = useState<Restaurant[]>(
    restaurantData as Restaurant[]
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
  const [highlightedActive, setHighlightedActive] = useState(false);
  const [awardsActive, setAwardsActive] = useState(false);
  const [highReviewCountActive, setHighReviewCountActive] = useState(false);
  const [highlightedRestaurantIds, setHighlightedRestaurantIds] = useState<
    Set<string>
  >(new Set());

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

  // Drawer height state (for coordinating UI elements)
  const [drawerHeight, setDrawerHeight] = useState(40);

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
          switch (filterType) {
            case "Cuisine":
              if (!restaurant.cuisine) return false;
              return values.some(
                (value) =>
                  restaurant.cuisine === value ||
                  restaurant.cuisine.toLowerCase().includes(value.toLowerCase())
              );
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
    if (highlightedActive) {
      filtered = filtered.filter((r) => highlightedRestaurantIds.has(r.slug));
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
            case "regular":
              return !restaurant.michelin_award && !restaurant.nyttop100_rank;
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
    highlightedActive,
    awardsActive,
    highReviewCountActive,
    legendFilters,
    favorites,
    highlightedRestaurantIds,
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
      return newMap;
    });
  }, []);

  const clearAllLayers = useCallback(() => {
    console.log("🗺️ MapContext: Clearing all layers");
    setIsochroneLayers([]);
    setLayerVisibilityMap(new Map());
    setIsochroneRegionSlugs(null);
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
        highlightedActive,
        setHighlightedActive,
        awardsActive,
        setAwardsActive,
        highReviewCountActive,
        setHighReviewCountActive,
        highlightedRestaurantIds,
        setHighlightedRestaurantIds,
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
        drawerHeight,
        setDrawerHeight,
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
