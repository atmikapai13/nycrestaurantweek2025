import { useMemo, useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import FilterDropdown from "./FilterDropdown";
import { useMap, hasAnyAward, applyRestaurantFilters, AWARDS_OPTIONS, MEAL_TYPE_OPTIONS, parseMealType } from "../contexts/MapContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { asset } from "../utils/asset";
import "./FilterBar.css";

// Icon shown on each Awards toggle button.
const AWARD_ICONS: Record<string, string> = {
  michelin: asset("/MichelinStar.svg.png"),
  bib: asset("/bibgourmand.png"),
  nyt: asset("/nytimes.png"),
};

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
    isochroneRegionSlugs,
    activeFilters,
    setActiveFilters,
    filterBarExpanded: isExpanded,
    setFilterBarExpanded: setIsExpanded,
    favorites,
    favoritesActive,
    setFavoritesActive,
    restaurantWeekActive,
    hasMenuActive,
    setHasMenuActive,
    awardsActive,
    highReviewCountActive,
    dateNightActive,
    setDateNightActive,
    legendFilters,
    onboardingRefineHint,
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
    setHasMenuActive(false);
    setDateNightActive(false);
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

  // Prix fixe price tiers, derived from the price prefix on meal_types
  // (e.g. "$60 Dinner") — price_range itself is almost always just "$".
  const priceOptions = useMemo(() => {
    const priceCounts = new Map<string, number>();
    allRestaurants.forEach((r) => {
      (r.meal_types || []).forEach((meal) => {
        const match = meal.match(/^\$\d+/);
        if (match) {
          const price = match[0];
          priceCounts.set(price, (priceCounts.get(price) || 0) + 1);
        }
      });
    });

    const allPrices = ["$30", "$45", "$60"];
    return allPrices
      .filter((price) => priceCounts.has(price))
      .map((price) => {
        const count = priceCounts.get(price) || 0;
        return {
          value: price,
          label: (
            <>
              {price} <span style={{ color: "#888" }}>· {count}</span>
            </>
          ),
        };
      });
  }, [allRestaurants]);

  // Toggle a single Awards value in/out of the "Awards" filter array.
  const toggleAward = (value: string) => {
    setActiveFilters((prevFilters) => {
      const current = prevFilters["Awards"] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const newFilters = { ...prevFilters };
      if (next.length === 0) {
        delete newFilters["Awards"];
      } else {
        newFilters["Awards"] = next;
      }
      return newFilters;
    });
  };

  const cuisineOptions = useMemo(() => {
    // Collect all distinct non-empty cuisines from the full dataset (so the
    // option list itself never shrinks — only counts and disabled state do)
    const allCuisines = new Set<string>();
    allRestaurants.forEach((r) => {
      if (r.cuisine) allCuisines.add(r.cuisine);
    });

    if (allCuisines.size === 0) {
      return [{ value: "", label: "No cuisines available", disabled: true }];
    }

    // Pool of restaurants matching every OTHER active filter (isochrone,
    // search, Price, Meal Type, Awards, Menu, Date Night, Favorites, …) but
    // NOT Cuisine itself — so counts reflect what's actually reachable given
    // the rest of the current selection, and options with a 0 count there
    // get disabled rather than silently returning nothing when clicked.
    const scoped = isochroneRegionSlugs
      ? allRestaurants.filter((r) => isochroneRegionSlugs.includes(r.slug))
      : allRestaurants;
    const searched = searchTerm.trim()
      ? scoped.filter((r) => r.name?.toLowerCase().includes(searchTerm.toLowerCase()))
      : scoped;
    const excludingCuisine = applyRestaurantFilters(searched, activeFilters, {
      favorites,
      favoritesActive,
      restaurantWeekActive,
      hasMenuActive,
      awardsActive,
      highReviewCountActive,
      dateNightActive,
      legendFilters,
    }, "Cuisine");

    const cuisineCounts = new Map<string, number>();
    excludingCuisine.forEach((r) => {
      if (r.cuisine) {
        cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) || 0) + 1);
      }
    });

    const otherFiltersActive =
      isochroneRegionSlugs !== null ||
      searchTerm.trim() !== "" ||
      favoritesActive ||
      restaurantWeekActive ||
      hasMenuActive ||
      awardsActive ||
      highReviewCountActive ||
      dateNightActive ||
      legendFilters.length > 0 ||
      Object.keys(activeFilters).some((k) => k !== "Cuisine" && activeFilters[k]?.length > 0);

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
          disabled: otherFiltersActive && count === 0,
        };
      });
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    searchTerm,
    activeFilters,
    favorites,
    favoritesActive,
    restaurantWeekActive,
    hasMenuActive,
    awardsActive,
    highReviewCountActive,
    dateNightActive,
    legendFilters,
  ]);

  // Meal Type is the price-independent half of meal_types (e.g. "$60 Dinner"
  // → "Dinner"). Counts restaurants offering that type at ANY price.
  const mealTypeOptions = useMemo(() => {
    const typeCounts = new Map<string, number>();
    allRestaurants.forEach((r) => {
      const typesSeen = new Set<string>();
      (r.meal_types || []).forEach((mealType) => {
        const parsed = parseMealType(mealType);
        if (parsed) typesSeen.add(parsed.type);
      });
      typesSeen.forEach((type) => {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      });
    });

    // Display-only label overrides — the underlying values stay as parsed
    // from the data ("Sunday Lunch/Brunch", "Sunday Dinner") for matching.
    const displayLabel: Record<string, string> = {
      "Sunday Lunch/Brunch": "Brunch (Sunday's)",
      "Sunday Dinner": "Dinner (Sunday's)",
    };

    return MEAL_TYPE_OPTIONS.filter((type) => typeCounts.has(type)).map((type) => {
      const count = typeCounts.get(type) || 0;
      return {
        value: type,
        label: (
          <>
            {displayLabel[type] ?? type} <span style={{ color: "#888" }}>· {count}</span>
          </>
        ),
      };
    });
  }, [allRestaurants]);

  void showLeftArrow;
  void showRightArrow;

  return (
    <>
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
          <FilterDropdown
            label="Price"
            icon=""
            options={priceOptions}
            selectedValues={activeFilters["Price"] || []}
            onChange={(values) => handleFilterChange("Price", values)}
          />

          <FilterDropdown
            label="Cuisine"
            icon=""
            options={cuisineOptions}
            selectedValues={activeFilters["Cuisine"] || []}
            onChange={(values) => handleFilterChange("Cuisine", values)}
          />

          {AWARDS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`filter-pill-base ${
                (activeFilters["Awards"] || []).includes(value) ? "active" : ""
              }`}
              onClick={() => toggleAward(value)}
            >
              {AWARD_ICONS[value] && (
                <img src={AWARD_ICONS[value]} alt="" className="filter-pill-icon-img" />
              )}
              {label}
            </button>
          ))}

          <button
            className={`filter-pill-base ${dateNightActive ? "active" : ""}`}
            onClick={() => setDateNightActive((v) => !v)}
          >
            For Date Night
          </button>

          <FilterDropdown
            label="Prix Fixe Course"
            icon=""
            options={mealTypeOptions}
            selectedValues={activeFilters["Meal Type"] || []}
            onChange={(values) => handleFilterChange("Meal Type", values)}
          />

          <button
            className={`filter-pill-base ${hasMenuActive ? "active" : ""}`}
            onClick={() => setHasMenuActive((v) => !v)}
          >
            Has Menu
          </button>

          <button
            className={`filter-pill-base ${favoritesActive ? "active" : ""}`}
            onClick={() => setFavoritesActive((v) => !v)}
          >
            ♥ Favorites
          </button>

          {(Object.keys(activeFilters).length > 0 || favoritesActive || hasMenuActive || dateNightActive) && (
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
