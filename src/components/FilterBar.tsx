import { useMemo, useState, useEffect, useRef } from 'react'
import FilterDropdown from './FilterDropdown'
import type { Restaurant } from '../types/restaurant'
import './FilterBar.css'

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
    return null
  }
  const slugSet = new Set(isochroneRegionSlugs)
  return allRestaurants.filter(r => slugSet.has(r.slug))
}

interface FilterBarProps {
  allRestaurants: Restaurant[]
  isochroneRegionSlugs: string[] | null
  onFilterChange: (filterType: string, values: string[]) => void
  activeFilters: Record<string, string[]>
  hasUserQueried?: boolean
  totalRestaurants?: number
  favoritesCount?: number
  highlightedCount?: number
  highlightedRestaurantIds?: Set<string>
  restaurantWeekActive?: boolean
  onRestaurantWeekToggle?: () => void
  favoritesActive?: boolean
  onFavoritesToggle?: () => void
  hasMenuActive?: boolean
  onHasMenuToggle?: () => void
  remisRecsActive?: boolean
  onRemisRecsToggle?: () => void
  highReviewCountActive?: boolean
  onHighReviewCountToggle?: () => void
}

export default function FilterBar({
  allRestaurants,
  isochroneRegionSlugs,
  onFilterChange,
  activeFilters,
  highlightedCount = 0,
  highlightedRestaurantIds,
  restaurantWeekActive = false,
  onRestaurantWeekToggle,
  favoritesActive = false,
  onFavoritesToggle,
  hasMenuActive = false,
  onHasMenuToggle,
  remisRecsActive = false,
  onRemisRecsToggle,
  highReviewCountActive = false,
  onHighReviewCountToggle
}: FilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  // Check scroll position to show/hide arrows
  const checkScrollPosition = () => {
    if (filterBarRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = filterBarRef.current
      setShowLeftArrow(scrollLeft > 10) // Show left arrow if scrolled right
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10) // Show right arrow if more content
    }
  }

  // Scroll filter bar
  const scrollFilterBar = (direction: 'left' | 'right') => {
    if (filterBarRef.current) {
      const scrollAmount = 200
      filterBarRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  // Check scroll position on mount and when filters change
  useEffect(() => {
    checkScrollPosition()
  }, [activeFilters, isExpanded])

  // Add scroll listener
  useEffect(() => {
    const filterBar = filterBarRef.current
    if (filterBar) {
      filterBar.addEventListener('scroll', checkScrollPosition)
      return () => filterBar.removeEventListener('scroll', checkScrollPosition)
    }
  }, [])

  // Handler to reset all filters
  const handleResetFilters = () => {
    onFilterChange('Price', [])
    onFilterChange('Participation Weeks', [])
    onFilterChange('Meal Types', [])
    onFilterChange('Cuisine', [])
    onFilterChange('Yelp Rating', [])
    onFilterChange('Badges', [])
    if (restaurantWeekActive && onRestaurantWeekToggle) {
      onRestaurantWeekToggle()
    }
    if (favoritesActive && onFavoritesToggle) {
      onFavoritesToggle()
    }
    if (hasMenuActive && onHasMenuToggle) {
      onHasMenuToggle()
    }
    if (remisRecsActive && onRemisRecsToggle) {
      onRemisRecsToggle()
    }
    if (highReviewCountActive && onHighReviewCountToggle) {
      onHighReviewCountToggle()
    }
  }

  // Toggle filter bar expansion
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  // Generate price options - disable unavailable prices when isochrone is active
  const priceOptions = useMemo(() => {
    const isochroneRestaurants = getIsochroneRestaurants(allRestaurants, isochroneRegionSlugs)
    const availablePrices = new Set<string>()

    // If isochrone is active, find which prices exist in the pool
    if (isochroneRestaurants) {
      isochroneRestaurants.forEach(r => {
        const price = (r as any).price ?? r.price_range
        if (price) availablePrices.add(price)
      })
    }

    // All possible price options
    const allPrices = ['$', '$$', '$$$', '$$$$']

    return allPrices.map(price => ({
      value: price,
      label: price,
      disabled: isochroneRestaurants !== null && !availablePrices.has(price)
    }))
  }, [allRestaurants, isochroneRegionSlugs])

  // Extract unique cuisines from restaurant data
  const cuisineOptions = useMemo(() => {
    const isochroneRestaurants = getIsochroneRestaurants(allRestaurants, isochroneRegionSlugs)
    const availableCuisines = new Set<string>()
    const allCuisines = new Set<string>()
    const cuisineCounts = new Map<string, number>()

    // Collect all cuisines from full dataset
    allRestaurants.forEach(r => {
      if (r.cuisine) allCuisines.add(r.cuisine)
    })

    // Determine which restaurant set to count from (priority: highlighted > isochrone > all)
    let countSource = allRestaurants
    if (isochroneRestaurants && isochroneRestaurants.length > 0) {
      countSource = isochroneRestaurants
      isochroneRestaurants.forEach(r => {
        if (r.cuisine) availableCuisines.add(r.cuisine)
      })
    }

    // If there are highlighted restaurants, use those for counts
    if (highlightedRestaurantIds && highlightedRestaurantIds.size > 0) {
      const highlightedRestaurants = allRestaurants.filter(r => highlightedRestaurantIds.has(r.slug))
      countSource = highlightedRestaurants
    }

    // Count cuisines from the selected source
    countSource.forEach(r => {
      if (r.cuisine) {
        cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) || 0) + 1)
      }
    })

    if (allCuisines.size === 0) {
      return [{ value: '', label: 'No cuisines available', disabled: true }]
    }

    // Sort alphabetically
    return Array.from(allCuisines)
      .sort((a, b) => a.localeCompare(b))
      .map(cuisine => {
        const count = cuisineCounts.get(cuisine) || 0
        return {
          value: cuisine,
          label: count > 0 ? `${cuisine} · ${count}` : cuisine,
          disabled: isochroneRestaurants !== null && !availableCuisines.has(cuisine)
        }
      })
  }, [allRestaurants, isochroneRegionSlugs, highlightedRestaurantIds])

  // Check if there's any yelp rating data
  const hasYelpRatings = useMemo(() => {
    return allRestaurants.some(r => r.yelp_rating !== null && r.yelp_rating !== undefined)
  }, [allRestaurants])

  // Generate rating options - disable unavailable ratings when isochrone is active
  const ratingOptions = useMemo(() => {
    const isochroneRestaurants = getIsochroneRestaurants(allRestaurants, isochroneRegionSlugs)
    const hasRatingInRange = (minRating: number): boolean => {
      if (!isochroneRestaurants) return true // No isochrone = all enabled

      return isochroneRestaurants.some(r => {
        const rating = (r as any).yelp_rating as number | undefined
        return typeof rating === 'number' && rating >= minRating
      })
    }

    // All possible rating options
    const allRatings: Array<{ value: string; label: string; threshold: number }> = [
      { value: '3.0', label: '★★★', threshold: 3.0 },
      { value: '3.5', label: '★★★☆', threshold: 3.5 },
      { value: '4.0', label: '★★★★', threshold: 4.0 },
      { value: '4.5', label: '★★★★☆', threshold: 4.5 } //½
    ]

    return allRatings.map(rating => ({
      value: rating.value,
      label: rating.label,
      disabled: !hasRatingInRange(rating.threshold)
    }))
  }, [allRestaurants, isochroneRegionSlugs])

  // Generate meal types options - disable unavailable meal types when isochrone is active
  const mealTypesOptions = useMemo(() => {
    const isochroneRestaurants = getIsochroneRestaurants(allRestaurants, isochroneRegionSlugs)
    const availableMealTypes = new Set<string>()
    const mealTypeCounts = new Map<string, number>()

    // Count meal types from full dataset
    allRestaurants.forEach(r => {
      if (r.meal_types && Array.isArray(r.meal_types)) {
        r.meal_types.forEach(mealType => {
          mealTypeCounts.set(mealType, (mealTypeCounts.get(mealType) || 0) + 1)
        })
      }
    })

    // If isochrone is active, collect meal types from isochrone pool
    if (isochroneRestaurants) {
      isochroneRestaurants.forEach(r => {
        if (r.meal_types && Array.isArray(r.meal_types)) {
          r.meal_types.forEach(mealType => availableMealTypes.add(mealType))
        }
      })
    }

    if (mealTypeCounts.size === 0) {
      return [{ value: '', label: 'No meal types available', disabled: true }]
    }

    // Custom sort order: $30, $45, $60, brunch, lunch, dinner, then any others alphabetically
    const customOrder = ['$30', '$45', '$60', 'brunch', 'lunch', 'dinner']
    return Array.from(mealTypeCounts.keys())
      .sort((a, b) => {
        const aIndex = customOrder.indexOf(a.toLowerCase())
        const bIndex = customOrder.indexOf(b.toLowerCase())

        // If both are in custom order, use that order
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
        // If only a is in custom order, a comes first
        if (aIndex !== -1) return -1
        // If only b is in custom order, b comes first
        if (bIndex !== -1) return 1
        // Otherwise sort alphabetically
        return a.localeCompare(b)
      })
      .map(mealType => ({
        value: mealType,
        label: mealType,
        disabled: isochroneRestaurants !== null && !availableMealTypes.has(mealType)
      }))
  }, [allRestaurants, isochroneRegionSlugs])

  // Generate award options
  const awardOptions = useMemo(() => {
    return [
      { value: 'michelin', label: 'Michelin', disabled: false, icon: '/MichelinStar.svg.png' },
      { value: 'bib', label: 'Bib Gourmand', disabled: false, icon: '/bibgourmand.png' },
      { value: 'nyt', label: 'NYT Top 100', disabled: false, icon: '/nytimes.png' }
    ]
  }, [])

  // Generate participation weeks options - disable unavailable weeks when isochrone is active
  const participationWeeksOptions = useMemo(() => {
    const isochroneRestaurants = getIsochroneRestaurants(allRestaurants, isochroneRegionSlugs)
    const availableWeeks = new Set<string>()
    const weekCounts = new Map<string, number>()

    // Count weeks from full dataset
    allRestaurants.forEach(r => {
      if (r.participation_weeks && Array.isArray(r.participation_weeks)) {
        r.participation_weeks.forEach(week => {
          weekCounts.set(week, (weekCounts.get(week) || 0) + 1)
        })
      }
    })

    // If isochrone is active, collect weeks from isochrone pool
    if (isochroneRestaurants) {
      isochroneRestaurants.forEach(r => {
        if (r.participation_weeks && Array.isArray(r.participation_weeks)) {
          r.participation_weeks.forEach(week => availableWeeks.add(week))
        }
      })
    }

    if (weekCounts.size === 0) {
      return [{ value: '', label: 'No weeks available', disabled: true }]
    }

    // Sort weeks chronologically by parsing the start date
    const sortDateRanges = (a: string, b: string) => {
      // Extract start date from format "Jan 20 - Jan 25" or "Jan 26 - Feb 1"
      const parseStartDate = (dateRange: string): Date => {
        const startDateStr = dateRange.split(' - ')[0].trim()
        // Assume current year (2025) - Restaurant Week dates
        const year = 2025
        const dateWithYear = `${startDateStr} ${year}`
        return new Date(dateWithYear)
      }

      const dateA = parseStartDate(a)
      const dateB = parseStartDate(b)
      return dateA.getTime() - dateB.getTime()
    }

    return Array.from(weekCounts.keys())
      .sort(sortDateRanges)
      .map(week => ({
        value: week,
        label: week,
        disabled: isochroneRestaurants !== null && !availableWeeks.has(week)
      }))
  }, [allRestaurants, isochroneRegionSlugs])

  return (
    <div className="filter-bar-container">
      {/* Hamburger Menu Button */}
      <button
        className="filter-hamburger-button"
        onClick={toggleExpanded}
        aria-label="Toggle filters"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
      </button>

      {/* Left Scroll Arrow - Mobile only */}
      {showLeftArrow && isExpanded && (
        <button
          className="filter-scroll-arrow filter-scroll-left"
          onClick={() => scrollFilterBar('left')}
          aria-label="Scroll left"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Filter Bar - Collapsible with Two Rows */}
      <div
        ref={filterBarRef}
        className={`filter-bar ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        {/* Row 1: Marker-based and Core Filters */}
        <div className="filter-row filter-row-markers">
          {/* Price Filter */}
          <FilterDropdown
            label="$$$"
            icon=""
            options={priceOptions}
            selectedValues={activeFilters['Price'] || []}
            onChange={(values) => onFilterChange('Price', values)}
          />

          {/* Yelp Rating Filter */}
          <FilterDropdown
            label="Yelp ★★★"
            icon=""
            options={ratingOptions}
            selectedValues={activeFilters['Yelp Rating'] || []}
            onChange={(values) => onFilterChange('Yelp Rating', values)}
            placeholder={!hasYelpRatings ? '⚠️ Rating data not available' : undefined}
          />

          {/* 500+ Reviews Button
              STANDARD PATTERN: Toggle button with pink active state */}
          {onHighReviewCountToggle && (
            <button
              className={`filter-pill-base high-review-count-button ${highReviewCountActive ? 'active' : ''}`}
              onClick={onHighReviewCountToggle}
            >
              500+ Reviews
            </button>
          )}

          {/* Cuisine Filter */}
          <FilterDropdown
            label="Cuisine"
            icon=""
            options={cuisineOptions}
            selectedValues={activeFilters['Cuisine'] || []}
            onChange={(values) => onFilterChange('Cuisine', values)}
          />

          {/* Award Winners Filter with red marker */}
          <FilterDropdown
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: '#c81224',
                  border: '1px solid white',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                }}></span>
                Award-winners
              </span>
            }
            icon=""
            options={awardOptions}
            selectedValues={activeFilters['Badges'] || []}
            onChange={(values) => onFilterChange('Badges', values)}
          />

          {/* Favorites Button
              STANDARD PATTERN: Toggle button with pink active state */}
          {onFavoritesToggle && (
            <button
              className={`filter-pill-base favorites-button ${favoritesActive ? 'active' : ''}`}
              onClick={onFavoritesToggle}
            >
              <span style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#FF69B4',
                marginRight: '6px',
                border: '1px solid white',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
              }}></span>
              Favorites
            </button>
          )}

          {/* Remi's Recs Button - only show when there are highlighted restaurants
              STANDARD PATTERN: Toggle button with pink active state */}
          {highlightedCount > 0 && onRemisRecsToggle && (
            <button
              className={`filter-pill-base remis-recs-button ${remisRecsActive ? 'active' : ''}`}
              onClick={onRemisRecsToggle}
            >
              <span style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#FF9100',
                marginRight: '6px',
                border: '1px solid white',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
              }}></span>
              Remi's Recs
            </button>
          )}
        </div>

        {/* Row 2: Restaurant Week Filters */}
        <div className="filter-row filter-row-main">
          {/* Restaurant Week Spring 2026 Button with NEW badge
              STANDARD PATTERN: Toggle button with pink active state */}
          {onRestaurantWeekToggle && (
            <button
              className={`filter-pill-base restaurant-week-button ${restaurantWeekActive ? 'active' : ''}`}
              onClick={onRestaurantWeekToggle}
            >
              <span className="new-badge">NEW</span> Restaurant Week
            </button>
          )}

          {/* Has Menu Button
              STANDARD PATTERN: Toggle button with pink active state */}
          {onHasMenuToggle && (
            <button
              className={`filter-pill-base has-menu-button ${hasMenuActive ? 'active' : ''}`}
              onClick={onHasMenuToggle}
            >
              Has Menu
            </button>
          )}

          {/* Meal Types Filter */}
          <FilterDropdown
            label="Special Menus"
            icon=""
            options={mealTypesOptions}
            selectedValues={activeFilters['Meal Types'] || []}
            onChange={(values) => onFilterChange('Meal Types', values)}
          />

          {/* Participation Weeks Filter */}
          <FilterDropdown
            label="Participating Weeks"
            icon=""
            options={participationWeeksOptions}
            selectedValues={activeFilters['Participation Weeks'] || []}
            onChange={(values) => onFilterChange('Participation Weeks', values)}
          />

          {/* Reset button - only show when filters are active */}
          {(Object.keys(activeFilters).length > 0 || restaurantWeekActive || favoritesActive || hasMenuActive || remisRecsActive || highReviewCountActive) && (
            <button
              className="filter-reset-button"
              onClick={handleResetFilters}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Right Scroll Arrow - Mobile only */}
      {showRightArrow && isExpanded && (
        <button
          className="filter-scroll-arrow filter-scroll-right"
          onClick={() => scrollFilterBar('right')}
          aria-label="Scroll right"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  )
}
