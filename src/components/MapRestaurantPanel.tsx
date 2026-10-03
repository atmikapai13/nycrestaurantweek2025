import { useEffect } from "react";
import { useMap } from "@/contexts/MapContext";
import RestaurantCard from "./RestaurantCard";

/** Card width; Map.tsx keeps the selected pin clear of it when it moves the camera. */
export const PANEL_CARD_WIDTH = 310;
/** Gap between the card and the map's right / bottom edges (bottom clears Mapbox's attribution). */
export const PANEL_INSET = { right: 16, bottom: 28 };

/**
 * Desktop: the selected restaurant's card, pinned to the bottom-right corner of the map. When the
 * restaurant is one of Remi's picks, the card shows his reason and travel times, and ← / → step
 * through his picks (the map flies to each).
 */
export default function MapRestaurantPanel({
  onToggleFavorite,
}: {
  onToggleFavorite?: (restaurantName: string) => void;
}) {
  const { selectedRestaurant, setSelectedRestaurant, recommendedPicks, allRestaurants, favorites } = useMap();

  // Remi's version of this restaurant (with match_reason), if it's one of his picks
  const pickIndex = selectedRestaurant ? recommendedPicks.findIndex((p) => p.slug === selectedRestaurant.slug) : -1;
  const restaurant = pickIndex >= 0 ? recommendedPicks[pickIndex] : selectedRestaurant;

  // ← / → step through Remi's picks (wrapping) while one of them is open; the map flies to each.
  // Ignored while typing (e.g. in the chat box) so the arrows still move the cursor there.
  useEffect(() => {
    if (pickIndex < 0 || recommendedPicks.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      e.stopPropagation(); // the map would otherwise pan too
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = recommendedPicks[(pickIndex + delta + recommendedPicks.length) % recommendedPicks.length];
      setSelectedRestaurant(allRestaurants.find((r) => r.slug === next.slug) ?? next);
    };
    // Capture phase, so this runs before the map's own arrow-key panning
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pickIndex, recommendedPicks, allRestaurants, setSelectedRestaurant]);

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
