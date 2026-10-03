import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import mapboxgl from "mapbox-gl";
import { useMap } from "@/contexts/MapContext";
import RestaurantCard from "./RestaurantCard";
import { SELECTED_PIN_SCALE } from "./restaurantLayers";
import "./MapRestaurantPopup.css";

/** Card width; Map.tsx pads the camera by this much on the right so the card fits. */
export const POPUP_CARD_WIDTH = 310;
// The selected restaurant's red pin (restaurantLayers.ts): at full size its visible top sits
// 42px above the location and it's 16px wide either side of it.
const PIN_HEIGHT = 42 * SELECTED_PIN_SCALE;
const PIN_HALF_WIDTH = 16 * SELECTED_PIN_SCALE;

/**
 * Desktop: the selected restaurant's card in a Mapbox popup to the right of its pin. It
 * follows the pin as the map moves, its top level with the pin's. When the restaurant is one of
 * Remi's picks, the card shows his reason and travel times, and ← / → step through his picks.
 */
export default function MapRestaurantPopup({
  map,
  onToggleFavorite,
}: {
  map: mapboxgl.Map | null;
  onToggleFavorite?: (restaurantName: string) => void;
}) {
  const { selectedRestaurant, setSelectedRestaurant, recommendedPicks, allRestaurants, favorites } = useMap();
  const container = useMemo(() => document.createElement("div"), []);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const [open, setOpen] = useState(false);

  // Remi's version of this restaurant (with match_reason), if it's one of his picks
  const pickIndex = selectedRestaurant ? recommendedPicks.findIndex((p) => p.slug === selectedRestaurant.slug) : -1;
  const restaurant = pickIndex >= 0 ? recommendedPicks[pickIndex] : selectedRestaurant;

  // Show / move / remove the popup as the selection changes
  useEffect(() => {
    if (!map) return;
    const { latitude, longitude } = selectedRestaurant ?? {};
    if (!selectedRestaurant || latitude == null || longitude == null) {
      popup.current?.remove();
      setOpen(false);
      return;
    }
    if (!popup.current) {
      popup.current = new mapboxgl.Popup({
        anchor: "top-left", // card to the right of the pin, its top level with the pin's top
        offset: [PIN_HALF_WIDTH + 10, -PIN_HEIGHT],
        closeButton: false,
        closeOnClick: false,
        focusAfterOpen: false,
        maxWidth: `${POPUP_CARD_WIDTH}px`,
        className: "restaurant-popup",
      }).setDOMContent(container);
    }
    popup.current.setLngLat([longitude, latitude]);
    if (!popup.current.isOpen()) popup.current.addTo(map);
    setOpen(true);
  }, [map, selectedRestaurant, container]);

  useEffect(() => () => void popup.current?.remove(), []);

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

  if (!open || !restaurant) return null;

  return createPortal(
    <div className="flex flex-col gap-1.5" style={{ width: POPUP_CARD_WIDTH }}>
      <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-xl">
        <RestaurantCard
          key={restaurant.slug}
          restaurant={restaurant}
          isFavorited={favorites.includes(restaurant.name)}
          onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(restaurant.name) : undefined}
          onClose={() => setSelectedRestaurant(null)}
        />
      </div>
    </div>,
    container
  );
}
