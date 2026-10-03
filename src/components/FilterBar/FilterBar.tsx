import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { useMap } from "@/contexts/MapContext";
import FilterDropdown from "./FilterDropdown";
import FavoritesFilter from "./FavoritesFilter";
import { filterPill } from "./filterPill";
import { useFilterOptions, type FilterKey } from "./useFilterOptions";
import "./FilterBar.css";

const isMobile = () => typeof window !== "undefined" && window.innerWidth <= 768;

/**
 * Filter pills over the map: Refine (show/hide), $$$, ★★★, 500+ Reviews, Cuisine, Awarded,
 * ♥ Favorites, Reset. Every pill shows the pink active state while it's filtering.
 */
export default function FilterBar() {
  const {
    activeFilters,
    setActiveFilters,
    setRestaurantWeekActive,
    favoritesActive,
    setFavoritesActive,
    hasMenuActive,
    setHasMenuActive,
    restaurantWeekActive,
    highReviewCountActive,
    setHighReviewCountActive,
    drawerHeight,
    setDrawerHeight,
    selectedRestaurant,
    setSelectedRestaurant,
    isochroneLayers,
    geocodedMarkers,
  } = useMap();
  const { priceOptions, ratingOptions, cuisineOptions, badgeOptions } = useFilterOptions();

  // Expanded on desktop, collapsed on mobile
  const [isExpanded, setIsExpanded] = useState(() => !isMobile());

  // On mobile, collapse when the drawer is pulled up to 55vh or 80vh
  useEffect(() => {
    if (isMobile() && (drawerHeight === 55 || drawerHeight === 80) && isExpanded) setIsExpanded(false);
  }, [drawerHeight, isExpanded]);

  // Collapse when something else takes over the map: an open restaurant card, travel-time
  // areas, or searched places. (Refine still expands it on demand.)
  const mapBusy = !!selectedRestaurant || isochroneLayers.length > 0 || geocodedMarkers.length > 0;
  const busyKey = `${selectedRestaurant?.slug ?? ""}|${isochroneLayers.length}|${geocodedMarkers.length}`;
  useEffect(() => {
    if (mapBusy) setIsExpanded(false);
  }, [busyKey]); // eslint-disable-line react-hooks/exhaustive-deps -- collapse on each new activity, not on every render

  const toggleExpanded = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    // Opening the filters closes the restaurant card, so the two don't compete for attention
    if (next) setSelectedRestaurant(null);
    // On mobile, expanding the bar lowers the drawer out of the way
    if (isMobile() && next) setDrawerHeight(8);
  };

  const setFilter = (key: FilterKey, values: string[]) =>
    setActiveFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });

  const anyActive =
    Object.keys(activeFilters).length > 0 ||
    restaurantWeekActive ||
    favoritesActive ||
    hasMenuActive ||
    highReviewCountActive;

  const resetAll = () => {
    setActiveFilters({});
    setRestaurantWeekActive(false);
    setFavoritesActive(false);
    setHasMenuActive(false);
    setHighReviewCountActive(false);
  };

  const dropdown = (key: FilterKey, label: string, options: typeof priceOptions, searchable = false) => (
    <FilterDropdown
      label={label}
      options={options}
      selectedValues={activeFilters[key] || []}
      onChange={(values) => setFilter(key, values)}
      searchable={searchable}
    />
  );

  return (
    <div className="filter-bar-container">
      <div className={`filter-bar-wrapper ${isExpanded ? "expanded" : "collapsed"}`}>
        <Button
          variant="outline"
          size="pill"
          onClick={toggleExpanded}
          aria-label="Toggle filters"
          className={cn(filterPill(false), "gap-1 text-xs md:text-xs", isExpanded && "px-2 md:px-2")}
        >
          <SlidersHorizontal className="!size-4" />
          {!isExpanded && <span>Refine</span>}
        </Button>

        <div className={`filter-row ${isExpanded ? "" : "is-collapsed"}`}>
          {/* Restaurant Week toggle and its Prix Fixe filters (useFilterOptions().mealTypesOptions)
              are hidden until the next Restaurant Week. */}
          {dropdown("Price", "$$$", priceOptions)}
          {dropdown("Yelp Rating", "★★★", ratingOptions)}

          <Toggle
            variant="outline"
            size="pill"
            pressed={highReviewCountActive}
            onPressedChange={setHighReviewCountActive}
            className={filterPill(highReviewCountActive)}
          >
            500+ Reviews
          </Toggle>

          {dropdown("Cuisine", "Cuisine", cuisineOptions, true)}
          {dropdown("Badges", "Awarded", badgeOptions)}
          <FavoritesFilter />

          {anyActive && (
            <Button
              size="pill"
              onClick={resetAll}
              aria-label="Reset all filters"
              className="pointer-events-auto shrink-0 bg-foreground font-sans text-background hover:bg-foreground"
            >
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
