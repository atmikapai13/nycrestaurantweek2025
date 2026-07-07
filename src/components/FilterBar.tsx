import { useMemo, useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import FilterDropdown from "./FilterDropdown";
import { useMap, hasAnyAward, DEAL_TAG_FILTERS, OFFER_26_OPTIONS, AWARDS_OPTIONS } from "../contexts/MapContext";
import { useIsMobile } from "@/hooks/use-mobile";
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
    filterBarExpanded: isExpanded,
    setFilterBarExpanded: setIsExpanded,
    favoritesActive,
    setFavoritesActive,
    onboardingRefineHint,
    onboardingMapBlocked,
    setOnboardingDismissRequested,
    searchTerm,
    setSearchTerm,
    searchExpanded,
    setSearchExpanded,
    setSelectedRestaurant,
  } = useMap();

  const isMobile = useIsMobile();
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
    const next = !isExpanded;
    setIsExpanded(next);
    if (next) {
      setSearchExpanded(false);
      setSelectedRestaurant(null);
      // On the onboarding card that points at Refine, using it ends the tour.
      if (onboardingRefineHint) setOnboardingDismissRequested(true);
    }
  };

  const toggleSearchExpanded = () => {
    const next = !searchExpanded;
    setSearchExpanded(next);
    if (next) {
      setIsExpanded(false);
      setSelectedRestaurant(null);
      // On the onboarding card that points at Search, using it ends the tour.
      if (onboardingRefineHint) setOnboardingDismissRequested(true);
    }
  };

  // Top 5 name matches for the search typeahead: matches at the start of the
  // name rank above matches elsewhere, then award winners rank above the rest.
  const searchSuggestions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return [];
    return allRestaurants
      .filter((r) => r.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(query);
        const bStarts = b.name.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        const aAward = hasAnyAward(a);
        const bAward = hasAnyAward(b);
        if (aAward !== bAward) return aAward ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 5);
  }, [searchTerm, allRestaurants]);

  const handleSelectSuggestion = (restaurant: (typeof searchSuggestions)[number]) => {
    setSelectedRestaurant(restaurant);
    setSearchTerm("");
    setSearchExpanded(false);
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
    <>
      {onboardingMapBlocked && <div className="onboarding-spotlight-overlay" aria-hidden="true" />}
      <div className="filter-bar-container">
        <div className={`filter-bar-wrapper ${isExpanded ? "expanded" : "collapsed"}`}>
        <div className="filter-hamburger-wrapper">
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

          {onboardingRefineHint && !isExpanded && (
            <svg
              className="filter-refine-hint"
              aria-hidden="true"
              width="46"
              height="34"
              viewBox="0 0 46 34"
              fill="none"
              stroke="#F23D97"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M42 17H6" />
              <path d="M14 9L6 17L14 25" />
            </svg>
          )}
        </div>

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

        {isMobile && (
          <div className="filter-search-wrapper">
            <div className="filter-hamburger-wrapper">
              <button
                className="filter-hamburger-button"
                onClick={toggleSearchExpanded}
                aria-label="Toggle search"
              >
                <Search size={16} color="#ffffff" strokeWidth={2} />
              </button>
            </div>

            {searchExpanded && (
              <div className="filter-search-input-wrap">
                <Search size={14} className="filter-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search restaurants…"
                  className="filter-search-input"
                  autoFocus
                />

                {searchSuggestions.length > 0 && (
                  <ul className="filter-search-suggestions">
                    {searchSuggestions.map((r) => (
                      <li key={r.slug}>
                        <button
                          type="button"
                          className="filter-search-suggestion"
                          onClick={() => handleSelectSuggestion(r)}
                        >
                          {r.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
    </div>
    </>
  );
}
