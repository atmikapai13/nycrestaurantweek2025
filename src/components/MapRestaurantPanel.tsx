import { useEffect, useMemo, useRef } from "react";
import type { Restaurant } from "../types/restaurant";
import { useMap } from "@/contexts/MapContext";
import RestaurantCard from "./RestaurantCard";
import { nearestTour } from "../utils/nearestTour";

/** How many nearest-neighbour steps the arrow keys can take past Remi's picks */
const TOUR_LENGTH = 40;

/** Card width; Map.tsx keeps the selected pin clear of it when it moves the camera. */
export const PANEL_CARD_WIDTH = 310;
/** Gap between the card and the map's right / bottom edges (bottom clears Mapbox's attribution). */
export const PANEL_INSET = { right: 16, bottom: 28 };

/**
 * Desktop: the selected restaurant's card, pinned to the bottom-right corner of the map. When the
 * restaurant is one of Remi's picks, the card shows his reason and travel times. ← / → step
 * through his picks, then on to the nearest restaurants (the map flies to each).
 */
export default function MapRestaurantPanel({
  onToggleFavorite,
}: {
  onToggleFavorite?: (restaurantName: string) => void;
}) {
  const { selectedRestaurant, setSelectedRestaurant, recommendedPicks, allRestaurants, filteredRestaurants, favorites } =
    useMap();

  // Remi's version of this restaurant (with match_reason), if it's one of his picks
  const pickIndex = selectedRestaurant ? recommendedPicks.findIndex((p) => p.slug === selectedRestaurant.slug) : -1;
  const restaurant = pickIndex >= 0 ? recommendedPicks[pickIndex] : selectedRestaurant;

  // ← / → browse: through Remi's picks in order, then on to the closest restaurant, then the
  // closest to that, and so on (among what's on the map: filters and visible area respected).
  // From a restaurant that isn't a pick, the walk starts there. ← retraces the path.
  // The walk is kept while the selection stays on it (so ← retraces it); selecting something off
  // it, or new picks / filters, starts a new one.
  const lastTour = useRef<{ tour: Restaurant[]; picks: Restaurant[]; pool: Restaurant[] } | null>(null);
  const tour = useMemo(() => {
    if (!selectedRestaurant) return [] as Restaurant[];
    const last = lastTour.current;
    if (
      last &&
      last.picks === recommendedPicks &&
      last.pool === filteredRestaurants &&
      last.tour.some((r) => r.slug === selectedRestaurant.slug)
    ) {
      return last.tour;
    }
    const start = pickIndex >= 0 ? recommendedPicks : [selectedRestaurant];
    return nearestTour(start, filteredRestaurants, TOUR_LENGTH);
  }, [selectedRestaurant, pickIndex, recommendedPicks, filteredRestaurants]);
  useEffect(() => {
    lastTour.current = { tour, picks: recommendedPicks, pool: filteredRestaurants };
  }, [tour, recommendedPicks, filteredRestaurants]);

  useEffect(() => {
    if (!selectedRestaurant || tour.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const index = tour.findIndex((r) => r.slug === selectedRestaurant.slug);
      const next = tour[index + (e.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      e.stopPropagation(); // the map would otherwise pan too
      setSelectedRestaurant(allRestaurants.find((r) => r.slug === next.slug) ?? next);
    };
    // Capture phase, so this runs before the map's own arrow-key panning
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tour, selectedRestaurant, allRestaurants, setSelectedRestaurant]);

  if (!restaurant) return null;

  return (
    <div
      className="absolute z-[800] overflow-y-auto rounded-xl"
      style={{
        right: PANEL_INSET.right,
        bottom: PANEL_INSET.bottom,
        width: PANEL_CARD_WIDTH,
        maxHeight: `calc(100% - ${PANEL_INSET.bottom + 90}px)`,
      }}
    >
      <RestaurantCard
        key={restaurant.slug}
        restaurant={restaurant}
        isFavorited={favorites.includes(restaurant.name)}
        onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(restaurant.name) : undefined}
        onClose={() => setSelectedRestaurant(null)}
        pickNumber={pickIndex >= 0 ? pickIndex + 1 : undefined}
      />
    </div>
  );
}
