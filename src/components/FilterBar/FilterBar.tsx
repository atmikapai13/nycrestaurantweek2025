import { useEffect, useRef, useState } from "react";
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
 * Filter pills over the map: Filter (show/hide), $$$, ★★★, 500+ Reviews, Cuisine, Awarded,
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
    selectedRestaurant,
    isochroneLayers,
    geocodedMarkers,
    onboardingActive,
    finishOnboarding,
    filterBarExpanded,
    setFilterBarExpanded,
    openFilterBar,
  } = useMap();
  const { priceOptions, ratingOptions, cuisineOptions, badgeOptions } = useFilterOptions();

  // Open/closed lives in MapContext, so Remi's messages can open it too
  const isExpanded = filterBarExpanded;
  const setIsExpanded = setFilterBarExpanded;

  // On mobile, collapse when the drawer is pulled up to 55vh or 80vh
  useEffect(() => {
    if (isMobile() && (drawerHeight === 55 || drawerHeight === 80) && isExpanded) setIsExpanded(false);
  }, [drawerHeight, isExpanded]);

  // Collapse when something new takes over the map: a restaurant card opens, a travel-time area
  // is added, or a place is pinned. Things going away (e.g. Filter closing the card) don't count,
  // or opening Filter would immediately collapse it again. Filter still expands it on demand.
  const previousActivity = useRef({ card: selectedRestaurant?.slug ?? null, areas: 0, places: 0 });
  useEffect(() => {
    const prev = previousActivity.current;
    const card = selectedRestaurant?.slug ?? null;
    const somethingNew =
      (card !== null && card !== prev.card) ||
      isochroneLayers.length > prev.areas ||
      geocodedMarkers.length > prev.places;
    previousActivity.current = { card, areas: isochroneLayers.length, places: geocodedMarkers.length };
    if (somethingNew) setIsExpanded(false);
  }, [selectedRestaurant, isochroneLayers.length, geocodedMarkers.length]);

  const toggleExpanded = () => {
    // Tapping Filter during the mobile walkthrough (which points at it) ends the walkthrough
    if (onboardingActive) finishOnboarding();
    if (isExpanded) setIsExpanded(false);
    else openFilterBar();
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

  // Which menu is open ("Price", "Cuisine", "Favorites", …); opening one closes the others
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuProps = (name: string) => ({
    open: openMenu === name,
    onOpenChange: (open: boolean) => setOpenMenu((current) => (open ? name : current === name ? null : current)),
  });

  const dropdown = (key: FilterKey, label: string, options: typeof priceOptions, searchable = false) => (
    <FilterDropdown
      label={label}
      options={options}
      selectedValues={activeFilters[key] || []}
      onChange={(values) => setFilter(key, values)}
      searchable={searchable}
      {...menuProps(key)}
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
          data-onboarding="filter"
          className={cn(filterPill(false), "gap-1 text-xs md:text-xs", isExpanded && "px-2 md:px-2")}
        >
          <SlidersHorizontal className="!size-4" />
          {!isExpanded && <span>Filter</span>}
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
          <FavoritesFilter {...menuProps("Favorites")} />

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
