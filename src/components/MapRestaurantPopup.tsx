import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import mapboxgl from "mapbox-gl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMap } from "@/contexts/MapContext";
import { Button } from "@/components/ui/button";
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
 * Remi's picks, the card shows his reason, with ‹ n of N › arrows under it that step through the
 * picks (the map flies to each).
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

  if (!open || !restaurant) return null;

  // Step to the previous / next pick; the selection change flies the map there
  const step = (delta: number) => {
    const next = recommendedPicks[(pickIndex + delta + recommendedPicks.length) % recommendedPicks.length];
    setSelectedRestaurant(allRestaurants.find((r) => r.slug === next.slug) ?? next);
  };

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
      {pickIndex >= 0 && recommendedPicks.length > 1 && (
        <div className="tw-reset flex items-center justify-between self-stretch rounded-md bg-card/95 px-1 py-0.5 font-sans shadow-sm">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => step(-1)} aria-label="Previous pick">
            <ChevronLeft className="!size-4" />
          </Button>
          <span className="text-caption font-medium text-muted-foreground">
            Remi's pick {pickIndex + 1} of {recommendedPicks.length}
          </span>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => step(1)} aria-label="Next pick">
            <ChevronRight className="!size-4" />
          </Button>
        </div>
      )}
    </div>,
    container
  );
}
