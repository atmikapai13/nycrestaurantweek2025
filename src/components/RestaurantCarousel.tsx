import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Restaurant } from "../types/restaurant";
import RestaurantCard from "./RestaurantCard";
import { nearestTour } from "../utils/nearestTour";
import "./RestaurantCarousel.css";

interface RestaurantCarouselProps {
  restaurants: Restaurant[];
  onRestaurantSelect?: (restaurant: Restaurant) => void;
  onToggleFavorite?: (restaurantName: string) => void;
  favorites: string[];
  onRequestReviewHighlights?: (prompt: string, slug: string) => void;
  onExpandDrawer?: () => void;
  /** Card shown first; remount (change `key`) to jump to another */
  startIndex?: number;
  /** "Remi's pick #N" label for a restaurant, if it's one of his picks */
  pickNumberFor?: (restaurant: Restaurant) => number | undefined;
  /** Swiping past the last card keeps going: the closest restaurant from this pool, then the
   *  closest to that, and so on (as desktop's ← / → do past Remi's picks) */
  continueWith?: Restaurant[];
}

export default function RestaurantCarousel({
  restaurants,
  onRestaurantSelect,
  onToggleFavorite,
  favorites,
  onRequestReviewHighlights,
  onExpandDrawer,
  startIndex = 0,
  pickNumberFor,
  continueWith,
}: RestaurantCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  // The cards: `restaurants`, then (with continueWith) one nearest restaurant past wherever the
  // user has swiped, so there's always a next card
  const extraSteps = continueWith ? Math.max(currentIndex + 2 - restaurants.length, 0) : 0;
  const cards = useMemo(
    () => (continueWith ? nearestTour(restaurants, continueWith, extraSteps) : restaurants),
    [restaurants, continueWith, extraSteps]
  );
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
    setCurrentIndex(startIndex);
    hasUserNavigated.current = false;

    // Auto-zoom to restaurant when there's only one result
    // (user can't navigate, so we trigger zoom immediately)
    if (restaurants.length === 1 && restaurants[0] && onRestaurantSelectRef.current) {
      onRestaurantSelectRef.current(restaurants[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants.length, startIndex]);

  // Notify parent when current restaurant changes (for map flyTo)
  // Only trigger after user has navigated, not on initial render
  useEffect(() => {
    if (hasUserNavigated.current && cards[currentIndex] && onRestaurantSelectRef.current) {
      onRestaurantSelectRef.current(cards[currentIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Navigate to specific card index
  const goToIndex = useCallback((index: number) => {
    if (index >= 0 && index < cards.length) {
      hasUserNavigated.current = true;
      setCurrentIndex(index);
    }
  }, [cards.length]);

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

  const currentRestaurant = cards[currentIndex] ?? restaurants[0];
  const showNavigation = cards.length > 1;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === cards.length - 1;

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
          <div className="carousel-card-wrapper">
            <RestaurantCard
              key={currentRestaurant.slug || currentIndex}
              restaurant={currentRestaurant}
              isFavorited={favorites.includes(currentRestaurant.name)}
              onToggleFavorite={
                onToggleFavorite
                  ? () => onToggleFavorite(currentRestaurant.name)
                  : undefined
              }
              onRequestReviewHighlights={onRequestReviewHighlights}
              onExpandDrawer={onExpandDrawer}
              pickNumber={pickNumberFor?.(currentRestaurant)}
            />
          </div>
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

      {/* Dot indicators for the starting restaurants (hidden for large lists); none is
          highlighted once you swipe past them */}
      {restaurants.length > 1 && restaurants.length <= 5 && (
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
