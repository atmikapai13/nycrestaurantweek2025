import { useEffect, useRef, type CSSProperties } from "react";
import "./App.css";
import FloatingHeader from "./components/FloatingHeader";
import FilterBar from "./components/FilterBar";
import Map from "./components/Map";
import MobileCardDrawer from "./components/MobileCardDrawer";
import type { Restaurant } from "./types/restaurant";
import { MapProvider, useMap } from "./contexts/MapContext";
import { API_CONFIG } from "./config/features";
import { AppSidebar } from "./components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

function AppContent() {
  const {
    allRestaurants,
    setActiveFilters,
    setLegendFilters,
    setSearchTerm,
    favorites,
    setFavorites,
    selectedRestaurant,
    setSelectedRestaurant,
  } = useMap();

  // Callback ref for map reset function (will be set by Map component)
  const mapResetRef = useRef<(() => void) | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    // Check for favorites in URL hash first, then localStorage
    const hash = window.location.hash;
    if (hash && hash.includes("favorites=")) {
      const favoritesParam = hash.split("favorites=")[1].split("&")[0];
      const favoriteSlugs = decodeURIComponent(favoritesParam).split(",");
      const favoriteNames = favoriteSlugs
        .map((slug) => allRestaurants.find((r) => r.slug === slug)?.name)
        .filter((name): name is string => name !== undefined);
      setFavorites(favoriteNames);
      localStorage.setItem(
        "restaurantFavorites",
        JSON.stringify(favoriteNames)
      );
    } else {
      // Load favorites from localStorage
      const savedFavorites = localStorage.getItem("restaurantFavorites");
      if (savedFavorites) {
        setFavorites(JSON.parse(savedFavorites));
      } else {
        // Default to Francie as favorite for new users (demonstrates the feature)
        const defaultFavorites = ["Francie"];
        setFavorites(defaultFavorites);
        localStorage.setItem(
          "restaurantFavorites",
          JSON.stringify(defaultFavorites)
        );
      }
    }
  }, [allRestaurants, setFavorites]);

  // Warm up the serverless backend on page load to avoid cold-start delay
  useEffect(() => {
    fetch(API_CONFIG.CHAT_URL).catch(() => {});
  }, []);

  // iOS Safari URL bar collapse trick - scroll by 1px on load to trigger collapse
  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // Small timeout to ensure page is fully rendered
      setTimeout(() => {
        window.scrollTo(0, 1);
      }, 100);
    }
  }, []);

  const toggleFavorite = (restaurantName: string) => {
    const newFavorites = favorites.includes(restaurantName)
      ? favorites.filter((name) => name !== restaurantName)
      : [...favorites, restaurantName];

    setFavorites(newFavorites);
    localStorage.setItem("restaurantFavorites", JSON.stringify(newFavorites));

    // Update URL hash with favorites
    updateFavoritesHash(newFavorites);
  };

  const updateFavoritesHash = (favoriteNames: string[]) => {
    if (favoriteNames.length === 0) {
      // Remove favorites from hash if empty
      const currentHash = window.location.hash;
      const newHash = currentHash.replace(/&?favorites=[^&]*/, "");
      window.location.hash = newHash || "#";
    } else {
      // Add favorites to hash
      const favoriteSlugs = favoriteNames
        .map((name) => allRestaurants.find((r) => r.name === name)?.slug)
        .filter((slug): slug is string => slug !== undefined);

      const favoritesParam = encodeURIComponent(favoriteSlugs.join(","));
      // Always use a clean hash format
      window.location.hash = `favorites=${favoritesParam}`;
    }
  };

  const handleFilterChange = (filterType: string, values: string[]) => {
    setActiveFilters((prevFilters) => {
      const newFilters = { ...prevFilters };
      if (values.length === 0) {
        delete newFilters[filterType];
      } else {
        newFilters[filterType] = values;
      }
      return newFilters;
    });
  };

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
  };

  const handleResetAll = () => {
    setActiveFilters({});
    setLegendFilters([]);
    setSearchTerm("");
    setSelectedRestaurant(null);

    // Also reset map state (isochrones, view) if the callback is available
    if (mapResetRef.current) {
      mapResetRef.current();
    }
  };

  const mapArea = (
    <div className="map-section">
      <Map
        onRestaurantSelect={handleRestaurantSelect}
        onToggleFavorite={toggleFavorite}
        onFilterChange={handleFilterChange}
        onResetAll={handleResetAll}
        mapResetRef={mapResetRef}
      />

      {/* Desktop: the restaurant card renders as a Mapbox popup anchored above the
          marker (handled inside <Map>). Mobile uses the bottom-sheet drawer below. */}
    </div>
  );

  // Mobile: keep the original full-screen layout (floating header + map).
  if (isMobile) {
    return (
      <div className="app">
        <FloatingHeader />
        <FilterBar />
        {mapArea}
        <MobileCardDrawer
          selectedRestaurant={selectedRestaurant}
          onSelect={handleRestaurantSelect}
          onCloseCard={() => setSelectedRestaurant(null)}
          isFavorited={selectedRestaurant ? favorites.includes(selectedRestaurant.name) : false}
          onToggleFavorite={() => selectedRestaurant && toggleFavorite(selectedRestaurant.name)}
        />
      </div>
    );
  }

  // Desktop: shadcn sidebar on the left, map fills the rest.
  return (
    <SidebarProvider style={{ "--sidebar-width": "26rem", height: "100vh" } as CSSProperties}>
      <AppSidebar onSelect={handleRestaurantSelect} />
      <main className="app-desktop-main">
        <FilterBar />
        {mapArea}
      </main>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <MapProvider>
      <AppContent />
    </MapProvider>
  );
}
