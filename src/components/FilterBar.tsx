import { useMemo, useState, useEffect, useRef } from "react";
import FilterDropdown from "./FilterDropdown";
import { useMap, DEAL_TAG_FILTERS, OFFER_26_OPTIONS, AWARDS_OPTIONS } from "../contexts/MapContext";
import "./FilterBar.css";

/**
 * FILTER BAR STANDARD PATTERN:
 *
 * All filters use pink active state (#FF69B4) when selections exist:
 * - FilterDropdown: Automatically applies 'active' class when selectedValues.length > 0
 * - Toggle buttons: Apply 'active' class when toggled on
 *
 * CSS styling (FilterBar.css):
 * - .filter-pill-button.active - Pink background/border for dropdowns
 * - .filter-pill-base.active - Pink background/border for toggle buttons
 *
 * Any new filters should follow this pattern.
 */

export default function FilterBar() {
  const {
    allRestaurants,
    activeFilters,
    setActiveFilters,
    drawerHeight,
    setDrawerHeight,
    favoritesActive,
    setFavoritesActive,
  } = useMap();

  // Start expanded on desktop, collapsed on mobile
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 768;
    }
    return true; // Default to expanded for SSR
  });

  // Collapse filter bar when drawer expands to 55vh or 80vh
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    if (isMobile && drawerHeight >= 55 && isExpanded) {
      setIsExpanded(false);
    }
  }, [drawerHeight, isExpanded]);

  const filterBarRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Handlers for filter changes
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

  // Toggle a promo filter key on/off ("on" when active, removed when off)
  const toggleFilterKey = (filterType: string) => {
    setActiveFilters((prevFilters) => {
      const newFilters = { ...prevFilters };
      if ((newFilters[filterType]?.length ?? 0) > 0) {
        delete newFilters[filterType];
      } else {
        newFilters[filterType] = ["on"];
      }
      return newFilters;
    });
  };

  const limitedEditionCupActive =
    (activeFilters["Limited Edition Cup"]?.length ?? 0) > 0;

  // Check scroll position to show/hide arrows
  const checkScrollPosition = () => {
    if (filterBarRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = filterBarRef.current;
      setShowLeftArrow(scrollLeft > 10);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  useEffect(() => {
    checkScrollPosition();
  }, [activeFilters, isExpanded]);

  useEffect(() => {
    const filterBar = filterBarRef.current;
    if (filterBar) {
      filterBar.addEventListener("scroll", checkScrollPosition);
      return () => filterBar.removeEventListener("scroll", checkScrollPosition);
    }
  }, []);

  const handleResetFilters = () => {
    setActiveFilters({});
    setFavoritesActive(false);
  };

  const toggleExpanded = () => {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    // On mobile: expanding filter bar → snap drawer to the peek snap point
    if (isMobile && newExpanded) {
      setDrawerHeight(35);
    }
  };

  const offer26Options = useMemo(() =>
    OFFER_26_OPTIONS.map(({ value, label }) => {
      const count = allRestaurants.filter(
        (r) => r.deal_tags?.includes(value)
      ).length;
      return {
        value,
        label: count > 0 ? (
          <>{label} <span style={{ color: "#888" }}>· {count}</span></>
        ) : label,
      };
    })
  , [allRestaurants]);

  const cuisineOptions = useMemo(() => {
    // Collect all distinct non-empty cuisines from the dataset
    const allCuisines = new Set<string>();
    allRestaurants.forEach((r) => {
      if (r.cuisine) allCuisines.add(r.cuisine);
    });

    if (allCuisines.size === 0) {
      return [{ value: "", label: "No cuisines available", disabled: true }];
    }

    // Count cuisines (for display)
    const cuisineCounts = new Map<string, number>();
    allRestaurants.forEach((r) => {
      if (r.cuisine) {
        cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) || 0) + 1);
      }
    });

    return Array.from(allCuisines)
      .sort((a, b) => a.localeCompare(b))
      .map((cuisine) => {
        const count = cuisineCounts.get(cuisine) || 0;
        return {
          value: cuisine,
          label:
            count > 0 ? (
              <>
                {cuisine} <span style={{ color: "#888" }}>· {count}</span>
              </>
            ) : (
              cuisine
            ),
        };
      });
  }, [allRestaurants]);

  void showLeftArrow;
  void showRightArrow;

  return (
    <div className="filter-bar-container">
      <div className={`filter-bar-wrapper ${isExpanded ? "expanded" : "collapsed"}`}>
        <button
          className="filter-hamburger-button"
          onClick={toggleExpanded}
          aria-label="Toggle filters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
            <circle cx="8" cy="6" r="2" fill="currentColor"/>
            <circle cx="16" cy="12" r="2" fill="currentColor"/>
            <circle cx="10" cy="18" r="2" fill="currentColor"/>
          </svg>
          {!isExpanded && <span className="filter-button-label">Refine</span>}
        </button>

        <div
          ref={filterBarRef}
          className={`filter-row ${isExpanded ? "" : "hidden"}`}
        >
          <button
            className={`filter-pill-base ${
              limitedEditionCupActive ? "active" : ""
            }`}
            onClick={() => toggleFilterKey("Limited Edition Cup")}
          >
            🏆  Collectible Cup
          </button>

          <FilterDropdown
            label="$26 Deal"
            icon=""
            options={offer26Options}
            selectedValues={activeFilters["$26 Offer"] || []}
            onChange={(values) => handleFilterChange("$26 Offer", values)}
          />

          <FilterDropdown
            label="Cuisine"
            icon=""
            options={cuisineOptions}
            selectedValues={activeFilters["Cuisine"] || []}
            onChange={(values) => handleFilterChange("Cuisine", values)}
          />

          {DEAL_TAG_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              className={`filter-pill-base ${
                (activeFilters[key]?.length ?? 0) > 0 ? "active" : ""
              }`}
              onClick={() => toggleFilterKey(key)}
            >
              {label}
            </button>
          ))}

          <FilterDropdown
            label="Awards"
            icon=""
            options={AWARDS_OPTIONS}
            selectedValues={activeFilters["Awards"] || []}
            onChange={(values) => handleFilterChange("Awards", values)}
          />

          <button
            className={`filter-pill-base ${favoritesActive ? "active" : ""}`}
            onClick={() => setFavoritesActive((v) => !v)}
          >
            ♥ Favorites
          </button>

          {(Object.keys(activeFilters).length > 0 || favoritesActive) && (
            <button
              className="filter-reset-button"
              onClick={handleResetFilters}
              aria-label="Reset all filters"
            >
              Reset
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
