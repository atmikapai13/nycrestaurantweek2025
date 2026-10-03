import { useState, useEffect, useRef, useCallback } from "react";
import type { Restaurant } from "../types/restaurant";
import { useMap } from "../contexts/MapContext";

const TRAVEL_ICONS = { walking: "🚶", cycling: "🚲", driving: "🚕", transit: "🚇" } as const;
import RestaurantCard from "./RestaurantCard";
import "./RestaurantCarousel.css";

interface RestaurantCarouselProps {
  restaurants: Restaurant[];
  onRestaurantSelect?: (restaurant: Restaurant) => void;
  onToggleFavorite?: (restaurantName: string) => void;
  favorites: string[];
  onRequestReviewHighlights?: (prompt: string, slug: string) => void;
  onExpandDrawer?: () => void;
  startFromLast?: boolean; // If true, show newest (last) item; if false, show first item
  collapsible?: boolean; // If true, hide accordions behind +more toggle (default: true)
}

export default function RestaurantCarousel({
  restaurants,
  onRestaurantSelect,
  onToggleFavorite,
  favorites,
  onRequestReviewHighlights,
  onExpandDrawer,
  startFromLast = false,
  collapsible = true,
}: RestaurantCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const hasUserNavigated = useRef(false);

  // Use ref for callback to avoid useEffect firing on every render
  const onRestaurantSelectRef = useRef(onRestaurantSelect);
  useEffect(() => {
    onRestaurantSelectRef.current = onRestaurantSelect;
  }, [onRestaurantSelect]);

  // Set initial index when restaurants change
  useEffect(() => {
    const newIndex = startFromLast ? restaurants.length - 1 : 0;
    setCurrentIndex(newIndex);
    hasUserNavigated.current = false;

    // Auto-zoom to restaurant when there's only one result
    // (user can't navigate, so we trigger zoom immediately)
    if (restaurants.length === 1 && restaurants[0] && onRestaurantSelectRef.current) {
      onRestaurantSelectRef.current(restaurants[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants.length, startFromLast]);

  // Notify parent when current restaurant changes (for map flyTo)
  // Only trigger after user has navigated, not on initial render
  useEffect(() => {
    if (hasUserNavigated.current && restaurants[currentIndex] && onRestaurantSelectRef.current) {
      onRestaurantSelectRef.current(restaurants[currentIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Navigate to specific card index
  const goToIndex = useCallback((index: number) => {
    if (index >= 0 && index < restaurants.length) {
      hasUserNavigated.current = true;
      setCurrentIndex(index);
    }
  }, [restaurants.length]);

  const goToPrevious = useCallback(() => {
    goToIndex(currentIndex - 1);
  }, [currentIndex, goToIndex]);

  const goToNext = useCallback(() => {
    goToIndex(currentIndex + 1);
  }, [currentIndex, goToIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this carousel or its children are focused
      if (!containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPrevious, goToNext]);

  // Touch/swipe handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) {
      return;
    }

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        // Swiped left -> go to next
        goToNext();
      } else {
        // Swiped right -> go to previous
        goToPrevious();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Don't render anything if no restaurants
  if (restaurants.length === 0) {
    return null;
  }

  const currentRestaurant = restaurants[currentIndex];
  // Distance from each pinned place (chat results only), shown between the card and the dots
  const reason = currentRestaurant?.match_reason;
  const distances = reason?.distances ?? [];
  const travelIcon = reason?.travelMode ? TRAVEL_ICONS[reason.travelMode] : null;
  const { geocodedMarkers } = useMap();
  // The map marker (character portrait) for a pin, matched by coordinates (~50 m)
  const markerFor = (pin?: { latitude: number; longitude: number }) =>
    pin &&
    geocodedMarkers.find(
      (m) => Math.abs(m.latitude - pin.latitude) < 0.0005 && Math.abs(m.longitude - pin.longitude) < 0.0005
    );
  const showNavigation = restaurants.length > 1;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === restaurants.length - 1;

  return (
    <div
      className="restaurant-carousel"
      ref={containerRef}
      tabIndex={0}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="carousel-content">
        {/* Left Arrow - positioned under Remi's avatar */}
        {showNavigation && !isFirst && (
          <button
            className="carousel-arrow carousel-arrow-left"
            onClick={goToPrevious}
            aria-label="Previous restaurant"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        {/* Card */}
        <div className="carousel-card-container">
          <div className={`carousel-card-wrapper${distances.length ? " has-distances" : ""}`}>
            <RestaurantCard
              key={currentRestaurant.slug || currentIndex}
              restaurant={currentRestaurant}
              collapsible={collapsible}
              isFavorited={favorites.includes(currentRestaurant.name)}
              onToggleFavorite={
                onToggleFavorite
                  ? () => onToggleFavorite(currentRestaurant.name)
                  : undefined
              }
              onRequestReviewHighlights={onRequestReviewHighlights}
              onExpandDrawer={onExpandDrawer}
            />
          </div>
          {/* Distance from each pinned place (chat results only) */}
          {distances.length > 0 && (
            <div className="match-distances">
              {distances.map((d, i) => {
                const pin = reason?.pins?.[i];
                const marker = markerFor(pin);
                // "0.5 mi from AMC Empire 25" → the pin's avatar goes right before the place name
                const [, lead = d, place = ""] = d.match(/^(.* from )(.+)$/) ?? [];
                return (
                  <div key={d} className="match-distance">
                    {(() => {
                      const legMode = reason?.legModes?.[i];
                      const icon = legMode ? TRAVEL_ICONS[legMode] : travelIcon;
                      return icon && <span className="match-distance-mode" aria-hidden="true">{icon}</span>;
                    })()}
                    <span>{lead}</span>
                    {pin?.isUser ? (
                      <span className="match-distance-you" aria-hidden="true" />
                    ) : marker ? (
                      <img className="match-distance-avatar" src={marker.characterImage} alt="" />
                    ) : null}
                    {place && <span>{place}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Arrow - Desktop only, shown when not at last card */}
        {showNavigation && !isLast ? (
          <button
            className="carousel-arrow carousel-arrow-right"
            onClick={goToNext}
            aria-label="Next restaurant"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          /* Always show spacer to keep card width consistent */
          <div className="carousel-arrow-spacer" />
        )}
      </div>

      {/* Dot Indicators (hide for large lists) */}
      {showNavigation && restaurants.length <= 5 && (
        <div className="carousel-dots">
          {restaurants.map((_, index) => (
            <button
              key={index}
              className={`carousel-dot ${index === currentIndex ? "carousel-dot-active" : ""}`}
              onClick={() => goToIndex(index)}
              aria-label={`Go to restaurant ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
