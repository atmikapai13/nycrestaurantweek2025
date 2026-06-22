import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import FilterDropdown from "./FilterDropdown";
import type { Restaurant } from "../types/restaurant";
import { useMap } from "../contexts/MapContext";
import { asset } from "../utils/asset";
import "./FilterBar.css";

/**
 * FILTER BAR STANDARD PATTERN:
 *
 * All filters use pink active state (#FF69B4) when selections exist:
 * - FilterDropdown: Automatically applies 'active' class when selectedValues.length > 0
 * - Toggle buttons: Apply 'active' class when toggled on (e.g., Restaurant Week, Award Winners, Favorites)
 *
 * CSS styling (FilterBar.css):
 * - .filter-pill-button.active - Pink background/border for dropdowns
 * - .restaurant-week-button.active, .award-winners-button.active, .favorites-button.active - Pink background/border for toggle buttons
 *
 * Any new filters should follow this pattern.
 */

// Helper to get restaurants in the current isochrone pool
function getIsochroneRestaurants(
  allRestaurants: Restaurant[],
  isochroneRegionSlugs: string[] | null
): Restaurant[] | null {
  if (!isochroneRegionSlugs || isochroneRegionSlugs.length === 0) {
    return null;
  }
  const slugSet = new Set(isochroneRegionSlugs);
  return allRestaurants.filter((r) => slugSet.has(r.slug));
}

export default function FilterBar() {
  const {
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    setActiveFilters,
    restaurantWeekActive,
    setRestaurantWeekActive,
    favoritesActive,
    setFavoritesActive,
    hasMenuActive,
    setHasMenuActive,
    highReviewCountActive,
    setHighReviewCountActive,
    drawerHeight,
    setDrawerHeight,
    favorites,
  } = useMap();

  // Helper to filter restaurants by all active filters except one (for dynamic counts)
  const getFilteredRestaurantsExcluding = (excludeFilter: string): Restaurant[] => {
    // Start with isochrone-scoped restaurants or all
    let filtered = isochroneRegionSlugs
      ? allRestaurants.filter((r) => isochroneRegionSlugs.includes(r.slug))
      : allRestaurants;

    // Apply dropdown filters (except the excluded one)
    Object.entries(activeFilters).forEach(([filterType, values]) => {
      if (filterType === excludeFilter || values.length === 0) return;

      filtered = filtered.filter((restaurant) => {
        switch (filterType) {
          case "Cuisine":
            if (!restaurant.cuisine) return false;
            return values.some(
              (value) =>
                restaurant.cuisine === value ||
                restaurant.cuisine.toLowerCase().includes(value.toLowerCase())
            );
          case "Meal Types":
            return (
              restaurant.meal_types &&
              Array.isArray(restaurant.meal_types) &&
              values.some((meal) => restaurant.meal_types?.includes(meal))
            );
          case "Price":
            return values.includes(
              (restaurant as any).price ?? restaurant.price_range
            );
          case "Yelp Rating": {
            const rating = (restaurant as any).yelp_rating as number | undefined;
            if (typeof rating !== "number") return false;
            const thresholds = values
              .map((v) => parseFloat(v))
              .filter((n) => !Number.isNaN(n));
            if (thresholds.length === 0) return true;
            const minThreshold = Math.min(...thresholds);
            return rating >= minThreshold;
          }
          case "Badges":
            return values.some((badge) => {
              switch (badge) {
                case "michelin":
                  return (
                    restaurant.michelin_award &&
                    ["ONE_STAR", "TWO_STARS", "THREE_STARS"].includes(
                      restaurant.michelin_award
                    )
                  );
                case "bib":
                  return restaurant.michelin_award === "BIB_GOURMAND";
                case "nyt":
                  return Boolean(restaurant.nyttop100_rank);
                default:
                  return false;
              }
            });
          default:
            return true;
        }
      });
    });

    // Apply toggle filters
    if (restaurantWeekActive) {
      filtered = filtered.filter(
        (r) => r.meal_types && Array.isArray(r.meal_types) && r.meal_types.length > 0
      );
    }
    if (favoritesActive) {
      filtered = filtered.filter((r) => favorites.includes(r.name));
    }
    if (hasMenuActive) {
      filtered = filtered.filter((r) => r.menu_url && r.menu_url.trim() !== "");
    }
    if (highReviewCountActive) {
      filtered = filtered.filter((r) => {
        const reviewCount = (r as any).yelp_review_count as number | undefined;
        return typeof reviewCount === "number" && reviewCount >= 500;
      });
    }

    return filtered;
  };

  // Start expanded on desktop, collapsed on mobile
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 768;
    }
    return true; // Default to expanded for SSR
  });

  // Share button state
  const [copied, setCopied] = useState(false);
  const [favoritesDropdownOpen, setFavoritesDropdownOpen] = useState(false);
  const [favoritesAlignRight, setFavoritesAlignRight] = useState(false);
  const favoritesDropdownRef = useRef<HTMLDivElement>(null);

  // Calculate favorites dropdown alignment based on viewport position
  useEffect(() => {
    if (favoritesDropdownOpen && favoritesDropdownRef.current) {
      const rect = favoritesDropdownRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const dropdownWidth = 180; // Approximate dropdown menu width
      const padding = 10;

      // If dropdown would overflow right edge, align to right
      const wouldOverflowRight = rect.left + dropdownWidth > viewportWidth - padding;
      // If dropdown is in right half of screen, align right
      const isInRightHalf = rect.left > viewportWidth / 2;

      setFavoritesAlignRight(wouldOverflowRight || isInRightHalf);
    }
  }, [favoritesDropdownOpen]);

  // Click outside to close favorites dropdown
  useEffect(() => {
    if (!favoritesDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (favoritesDropdownRef.current && !favoritesDropdownRef.current.contains(event.target as Node)) {
        setFavoritesDropdownOpen(false);
      }
    };

    // Small delay prevents immediate close on same click that opened dropdown
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [favoritesDropdownOpen]);

  const handleShare = useCallback(async () => {
    // Generate URL with slugs
    const slugs = favorites
      .map((name) => allRestaurants.find((r) => r.name === name)?.slug)
      .filter((slug): slug is string => slug !== undefined);

    const shareUrl = `${window.location.origin}${window.location.pathname}#favorites=${slugs.join(",")}`;

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }, [favorites, allRestaurants]);

  // Collapse filter bar when drawer expands to 55vh or 80vh
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    if (isMobile && (drawerHeight === 55 || drawerHeight === 80) && isExpanded) {
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

  const onRestaurantWeekToggle = () => {
    const newState = !restaurantWeekActive;
    setRestaurantWeekActive(newState);
    // When deactivating Restaurant Week, also deactivate related filters
    if (!newState) {
      setHasMenuActive(false);
      // Clear Meal Types filter
      setActiveFilters((prevFilters) => {
        const newFilters = { ...prevFilters };
        delete newFilters["Meal Types"];
        return newFilters;
      });
    }
  };
  const onFavoritesToggle = () => setFavoritesActive(!favoritesActive);
  const onHasMenuToggle = () => setHasMenuActive(!hasMenuActive);
  const onHighReviewCountToggle = () =>
    setHighReviewCountActive(!highReviewCountActive);

  // Check scroll position to show/hide arrows
  const checkScrollPosition = () => {
    if (filterBarRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = filterBarRef.current;
      setShowLeftArrow(scrollLeft > 10);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scrollFilterBar = (direction: "left" | "right") => {
    if (filterBarRef.current) {
      const scrollAmount = 200;
      filterBarRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
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
    setRestaurantWeekActive(false);
    setFavoritesActive(false);
    setHasMenuActive(false);
    setHighReviewCountActive(false);
  };

  const toggleExpanded = () => {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    // On mobile: expanding filter bar → move drawer to 8vh
    if (isMobile && newExpanded) {
      setDrawerHeight(8);
    }
  };

  const priceOptions = useMemo(() => {
    // Get restaurants filtered by all active filters EXCEPT price
    const filteredRestaurants = getFilteredRestaurantsExcluding("Price");

    // Count prices from the filtered set
    const priceCounts = new Map<string, number>();
    const availablePrices = new Set<string>();
    filteredRestaurants.forEach((r) => {
      const price = (r as any).price ?? r.price_range;
      if (price) {
        priceCounts.set(price, (priceCounts.get(price) || 0) + 1);
        availablePrices.add(price);
      }
    });

    // Check if any filters are active (to determine if we should disable empty options)
    const hasActiveFilters =
      isochroneRegionSlugs !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some(
        (k) => k !== "Price" && activeFilters[k]?.length > 0
      );

    const allPrices = ["$", "$$", "$$$", "$$$$"];

    return allPrices.map((price) => {
      const count = priceCounts.get(price) || 0;
      return {
        value: price,
        label: count > 0 ? (
          <>{price} <span style={{ color: '#888' }}>· {count}</span></>
        ) : price,
        disabled: hasActiveFilters && !availablePrices.has(price),
      };
    });
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);

  const cuisineOptions = useMemo(() => {
    // Get restaurants filtered by all active filters EXCEPT cuisine
    const filteredRestaurants = getFilteredRestaurantsExcluding("Cuisine");

    // Collect all cuisines from the full dataset (for the option list)
    const allCuisines = new Set<string>();
    allRestaurants.forEach((r) => {
      if (r.cuisine) allCuisines.add(r.cuisine);
    });

    // Count cuisines from the filtered set (dynamic counts)
    const cuisineCounts = new Map<string, number>();
    const availableCuisines = new Set<string>();
    filteredRestaurants.forEach((r) => {
      if (r.cuisine) {
        cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) || 0) + 1);
        availableCuisines.add(r.cuisine);
      }
    });

    if (allCuisines.size === 0) {
      return [{ value: "", label: "No cuisines available", disabled: true }];
    }

    // Check if any filters are active (to determine if we should disable unavailable options)
    const hasActiveFilters =
      isochroneRegionSlugs !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some(k => k !== "Cuisine" && activeFilters[k]?.length > 0);

    return Array.from(allCuisines)
      .sort((a, b) => a.localeCompare(b))
      .map((cuisine) => {
        const count = cuisineCounts.get(cuisine) || 0;
        return {
          value: cuisine,
          label: count > 0 ? (
            <>{cuisine} <span style={{ color: '#888' }}>· {count}</span></>
          ) : cuisine,
          disabled: hasActiveFilters && !availableCuisines.has(cuisine),
        };
      });
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);

  const ratingOptions = useMemo(() => {
    // Get restaurants filtered by all active filters EXCEPT Yelp Rating
    const filteredRestaurants = getFilteredRestaurantsExcluding("Yelp Rating");

    // Count restaurants at each rating threshold
    const countAtThreshold = (minRating: number): number => {
      return filteredRestaurants.filter((r) => {
        const rating = (r as any).yelp_rating as number | undefined;
        return typeof rating === "number" && rating >= minRating;
      }).length;
    };

    // Check if any filters are active
    const hasActiveFilters =
      isochroneRegionSlugs !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some(
        (k) => k !== "Yelp Rating" && activeFilters[k]?.length > 0
      );

    const allRatings = [
      { value: "3.0", label: "★★★", threshold: 3.0 },
      { value: "3.5", label: "★★★☆", threshold: 3.5 },
      { value: "4.0", label: "★★★★", threshold: 4.0 },
      { value: "4.5", label: "★★★★☆", threshold: 4.5 },
    ];

    return allRatings.map((rating) => {
      const count = countAtThreshold(rating.threshold);
      return {
        value: rating.value,
        label: count > 0 ? (
          <>{rating.label} <span style={{ color: '#888' }}>· {count}</span></>
        ) : rating.label,
        disabled: hasActiveFilters && count === 0,
      };
    });
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);

  const mealTypesOptions = useMemo(() => {
    // Get restaurants filtered by all active filters EXCEPT Meal Types
    const filteredRestaurants = getFilteredRestaurantsExcluding("Meal Types");

    // Collect all meal types from full dataset (for the option list)
    const allMealTypes = new Set<string>();
    allRestaurants.forEach((r) => {
      if (r.meal_types && Array.isArray(r.meal_types)) {
        r.meal_types.forEach((mealType) => allMealTypes.add(mealType));
      }
    });

    // Count meal types from the filtered set
    const mealTypeCounts = new Map<string, number>();
    const availableMealTypes = new Set<string>();
    filteredRestaurants.forEach((r) => {
      if (r.meal_types && Array.isArray(r.meal_types)) {
        r.meal_types.forEach((mealType) => {
          mealTypeCounts.set(mealType, (mealTypeCounts.get(mealType) || 0) + 1);
          availableMealTypes.add(mealType);
        });
      }
    });

    if (allMealTypes.size === 0) {
      return [{ value: "", label: "No meal types available", disabled: true }];
    }

    // Check if any filters are active
    const hasActiveFilters =
      isochroneRegionSlugs !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some(
        (k) => k !== "Meal Types" && activeFilters[k]?.length > 0
      );

    const customOrder = ["$30", "$45", "$60", "brunch", "lunch", "dinner"];
    return Array.from(allMealTypes)
      .sort((a, b) => {
        const aIndex = customOrder.indexOf(a.toLowerCase());
        const bIndex = customOrder.indexOf(b.toLowerCase());
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      })
      .map((mealType) => {
        const count = mealTypeCounts.get(mealType) || 0;
        return {
          value: mealType,
          label: count > 0 ? (
            <>{mealType} <span style={{ color: '#888' }}>· {count}</span></>
          ) : mealType,
          disabled: hasActiveFilters && !availableMealTypes.has(mealType),
        };
      });
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);

  const badgeOptions = useMemo(() => {
    // Get restaurants filtered by all active filters EXCEPT Badges
    const filteredRestaurants = getFilteredRestaurantsExcluding("Badges");

    // Count each badge type
    let michelinCount = 0;
    let bibCount = 0;
    let nytCount = 0;

    filteredRestaurants.forEach((r) => {
      if (r.michelin_award && ["ONE_STAR", "TWO_STARS", "THREE_STARS"].includes(r.michelin_award)) {
        michelinCount++;
      }
      if (r.michelin_award === "BIB_GOURMAND") {
        bibCount++;
      }
      if (r.nyttop100_rank) {
        nytCount++;
      }
    });

    // Check if any filters are active
    const hasActiveFilters =
      isochroneRegionSlugs !== null ||
      restaurantWeekActive ||
      favoritesActive ||
      hasMenuActive ||
      highReviewCountActive ||
      Object.keys(activeFilters).some(
        (k) => k !== "Badges" && activeFilters[k]?.length > 0
      );

    return [
      {
        value: "michelin",
        label: michelinCount > 0 ? (
          <>Michelin <span style={{ color: '#888' }}>· {michelinCount}</span></>
        ) : "Michelin",
        icon: asset("/MichelinStar.svg.png"),
        disabled: hasActiveFilters && michelinCount === 0,
      },
      {
        value: "bib",
        label: bibCount > 0 ? (
          <>Bib Gourmand <span style={{ color: '#888' }}>· {bibCount}</span></>
        ) : "Bib Gourmand",
        icon: asset("/bibgourmand.png"),
        disabled: hasActiveFilters && bibCount === 0,
      },
      {
        value: "nyt",
        label: nytCount > 0 ? (
          <>NYT Top 100 <span style={{ color: '#888' }}>· {nytCount}</span></>
        ) : "NYT Top 100",
        icon: asset("/nytimes.png"),
        disabled: hasActiveFilters && nytCount === 0,
      },
    ];
  }, [
    allRestaurants,
    isochroneRegionSlugs,
    activeFilters,
    restaurantWeekActive,
    favoritesActive,
    hasMenuActive,
    highReviewCountActive,
    favorites,
  ]);

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
          {/* Restaurant Week filter - commented out until next Restaurant Week
          <button
            className={`filter-pill-base restaurant-week-button ${
              restaurantWeekActive ? "active" : ""
            }`}
            onClick={onRestaurantWeekToggle}
          >
            <span className="new-badge">NEW</span>
            Restaurant Week
          </button>
          */}

          <FilterDropdown
            label="$$$"
            icon=""
            options={priceOptions}
            selectedValues={activeFilters["Price"] || []}
            onChange={(values) => handleFilterChange("Price", values)}
          />

          <FilterDropdown
            label="★★★"
            icon=""
            options={ratingOptions}
            selectedValues={activeFilters["Yelp Rating"] || []}
            onChange={(values) => handleFilterChange("Yelp Rating", values)}
          />

          <button
            className={`filter-pill-base high-review-count-button ${
              highReviewCountActive ? "active" : ""
            }`}
            onClick={onHighReviewCountToggle}
          >
            500+ Reviews
          </button>

          <FilterDropdown
            label="Cuisine"
            icon=""
            options={cuisineOptions}
            selectedValues={activeFilters["Cuisine"] || []}
            onChange={(values) => handleFilterChange("Cuisine", values)}
          />

          <FilterDropdown
            label={
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: "#c81224",
                    border: "1px solid white",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  }}
                ></span>
                Awarded
              </span>
            }
            icon=""
            options={badgeOptions}
            selectedValues={activeFilters["Badges"] || []}
            onChange={(values) => handleFilterChange("Badges", values)}
          />

          <div className="favorites-button-wrapper" ref={favoritesDropdownRef}>
            <button
              className={`filter-pill-base filter-pill-button favorites-button ${
                favoritesActive ? "active" : ""
              } ${favoritesDropdownOpen ? "dropdown-open" : ""}`}
              onClick={() => {
                if (favorites.length > 0) {
                  setFavoritesDropdownOpen(!favoritesDropdownOpen);
                }
                onFavoritesToggle();
              }}
              aria-label={favoritesActive ? "Hide favorites" : "Show favorites"}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: "#FF69B4",
                  border: "1px solid white",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                }}
              ></span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={favoritesActive ? "#FF69B4" : "none"} stroke="#FF69B4" strokeWidth="2.0">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              {favorites.length > 0 && <span className="filter-pill-arrow">{favoritesDropdownOpen ? '▲' : '▼'}</span>}
            </button>

            {/* Favorites dropdown menu */}
            {favoritesDropdownOpen && favorites.length > 0 && (
              <div className={`favorites-dropdown-menu ${favoritesAlignRight ? 'align-right' : 'align-left'}`}>
                <button
                  className="favorites-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShare();
                    // Delay closing so user sees "Copied!" confirmation
                    setTimeout(() => setFavoritesDropdownOpen(false), 1200);
                  }}
                >
                  {copied ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      URL Copied! Share away.
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.0">
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Share with Friends
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Prix Fixe filters - commented out until next Restaurant Week
          {restaurantWeekActive && (
            <>
              <button
                className={`filter-pill-base has-menu-button ${
                  hasMenuActive ? "active" : ""
                }`}
                onClick={onHasMenuToggle}
              >
                Published Prix Fixe Menu
              </button>

              <FilterDropdown
                label="Prix Fixe Types"
                icon=""
                options={mealTypesOptions}
                selectedValues={activeFilters["Meal Types"] || []}
                onChange={(values) => handleFilterChange("Meal Types", values)}
              />
            </>
          )}
          */}

          {(Object.keys(activeFilters).length > 0 ||
            restaurantWeekActive ||
            favoritesActive ||
            hasMenuActive ||
            highReviewCountActive) && (
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
