import { useState, useEffect, useRef } from 'react'
import './App.css'
import FloatingHeader from './components/FloatingHeader'
import FilterBar from './components/FilterBar'
import Map from './components/Map'
import type { Restaurant } from './types/restaurant'
import restaurantData from './data/FinalData.json'

function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [filteredRestaurants, setFilteredRestaurants] = useState<Restaurant[]>([])
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})
  const [legendFilters, setLegendFilters] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [favoritesActive, setFavoritesActive] = useState(false)
  const [restaurantWeekActive, setRestaurantWeekActive] = useState(false)
  const [hasMenuActive, setHasMenuActive] = useState(false)
  const [remisRecsActive, setRemisRecsActive] = useState(false)

  // Callback ref for map reset function (will be set by Map component)
  const mapResetRef = useRef<(() => void) | null>(null)

  // Highlighted restaurant IDs (for pink markers when searching/isochrone)
  const [highlightedRestaurantIds, setHighlightedRestaurantIds] = useState<Set<string>>(new Set())

  // Track if user has made their first query (to auto-expand filter bar)
  const [hasUserQueried, setHasUserQueried] = useState(false)

  // Store previous highlights when favorites mode is activated (to restore when deactivated)
  const previousHighlightedIdsRef = useRef<Set<string>>(new Set())

  // Isochrone region slugs (defines which restaurants are inside active isochrone polygon)
  const [isochroneRegionSlugs, setIsochroneRegionSlugs] = useState<string[] | null>(null)

  // FilterBar selections (separate from activeFilters - these create highlights, not hide restaurants)
  const [filterBarSelections, setFilterBarSelections] = useState<Record<string, string[]>>({})

  useEffect(() => {
    // Load restaurants from imported data
    setRestaurants(restaurantData as Restaurant[])
    setFilteredRestaurants(restaurantData as Restaurant[])

    // Check for favorites in URL hash first, then localStorage
    const hash = window.location.hash
    if (hash && hash.includes('favorites=')) {
      const favoritesParam = hash.split('favorites=')[1].split('&')[0]
      const favoriteSlugs = decodeURIComponent(favoritesParam).split(',')
      const favoriteNames = favoriteSlugs
        .map(slug => restaurantData.find(r => r.slug === slug)?.name)
        .filter((name): name is string => name !== undefined) // Type guard to ensure string[]
      setFavorites(favoriteNames)
      localStorage.setItem('restaurantFavorites', JSON.stringify(favoriteNames))
    } else {
      // Load favorites from localStorage
      const savedFavorites = localStorage.getItem('restaurantFavorites')
      if (savedFavorites) {
        setFavorites(JSON.parse(savedFavorites))
      } else {
        // Default to Fish Cheeks as favorite for new users
        const defaultFavorites = ['Fish Cheeks']
        setFavorites(defaultFavorites)
        localStorage.setItem('restaurantFavorites', JSON.stringify(defaultFavorites))
      }
    }
  }, [])

  const toggleFavorite = (restaurantName: string) => {
    const newFavorites = favorites.includes(restaurantName)
      ? favorites.filter(name => name !== restaurantName)
      : [...favorites, restaurantName]

    setFavorites(newFavorites)
    localStorage.setItem('restaurantFavorites', JSON.stringify(newFavorites))

    // Update URL hash with favorites
    updateFavoritesHash(newFavorites)
  }

  const updateFavoritesHash = (favoriteNames: string[]) => {
    if (favoriteNames.length === 0) {
      // Remove favorites from hash if empty
      const currentHash = window.location.hash
      const newHash = currentHash.replace(/&?favorites=[^&]*/, '')
      window.location.hash = newHash || '#'
    } else {
      // Add favorites to hash
      const favoriteSlugs = favoriteNames
        .map(name => restaurantData.find(r => r.name === name)?.slug)
        .filter((slug): slug is string => slug !== undefined)

      const favoritesParam = encodeURIComponent(favoriteSlugs.join(','))
      // Always use a clean hash format
      window.location.hash = `favorites=${favoritesParam}`
    }
  }

  const handleFavoritesToggle = () => {
    setFavoritesActive(!favoritesActive)
  }

  const handleRestaurantWeekToggle = () => {
    setRestaurantWeekActive(!restaurantWeekActive)
  }

  const handleHasMenuToggle = () => {
    setHasMenuActive(!hasMenuActive)
  }

  const handleRemisRecsToggle = () => {
    setRemisRecsActive(!remisRecsActive)
  }

  const applyFilters = (restaurantsToFilter: Restaurant[]) => {
    let filtered = restaurantsToFilter

    // Apply active filters
    Object.entries(activeFilters).forEach(([filterType, values]) => {
      if (values.length > 0) {
        filtered = filtered.filter(restaurant => {
          switch (filterType) {
            case 'Cuisine':
              // Support both exact match and partial match (for chatbot)
              if (!restaurant.cuisine) return false
              return values.some(value =>
                restaurant.cuisine === value ||
                restaurant.cuisine.toLowerCase().includes(value.toLowerCase())
              )
            case 'Meal Types':
              return restaurant.meal_types && values.some(meal => restaurant.meal_types.includes(meal))
            case 'Price':
              // Prefer v2 `price` if present, otherwise fall back to `price_range`
              return values.includes((restaurant as any).price ?? restaurant.price_range)
            case 'Participation Weeks':
              // Check if restaurant participates in any of the selected weeks
              return restaurant.participation_weeks && Array.isArray(restaurant.participation_weeks) &&
                     values.some(week => restaurant.participation_weeks.includes(week))
            case 'Yelp Rating': {
              const rating = (restaurant as any).yelp_rating as number | undefined
              if (typeof rating !== 'number') return false
              const thresholds = values.map(v => parseFloat(v)).filter(n => !Number.isNaN(n))
              if (thresholds.length === 0) return true
              const minThreshold = Math.min(...thresholds)
              return rating >= minThreshold
            }
            case 'Collections':
            case 'Vibes':
              return restaurant.collections && values.some(collection => restaurant.collections.includes(collection))
            case 'Badges': {
              // OR logic: match if restaurant has ANY of the selected badges
              return values.some((badge) => {
                switch (badge) {
                  case 'michelin':
                    return restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)
                  case 'bib':
                  case 'bib_gourmand':  // Support both formats
                    return restaurant.michelin_award === 'BIB_GOURMAND'
                  case 'nyt':
                  case 'nyt_top_100':  // Support both formats
                    return Boolean(restaurant.nyttop100_rank)
                  default:
                    return false
                }
              })
            }
            case 'Semantic Features': {
              // Search for keywords in yelp_review_highlights
              const highlights = restaurant.yelp_review_highlights?.toLowerCase() || ''
              if (!highlights) return false
              // Match if ANY keyword is found in the highlights
              return values.some(keyword => keyword && highlights.includes(keyword.toLowerCase()))
            }
            case 'Semantic Search Results': {
              // Filter to only show restaurants that match the slugs from semantic search
              return values.some(slug => restaurant.slug === slug)
            }
            default:
              return true
          }
        })
      }
    })

    // Apply Restaurant Week filter
    if (restaurantWeekActive) {
      filtered = filtered.filter(restaurant => {
        return restaurant.meal_types && Array.isArray(restaurant.meal_types) && restaurant.meal_types.length > 0
      })
    }

    // Apply Favorites filter
    if (favoritesActive) {
      filtered = filtered.filter(restaurant => {
        return favorites.includes(restaurant.name)
      })
    }

    // Apply Has Menu filter
    if (hasMenuActive) {
      filtered = filtered.filter(restaurant => {
        return restaurant.menu_url && restaurant.menu_url.trim() !== ''
      })
    }

    // Apply Remi's Recs filter (only show highlighted restaurants)
    if (remisRecsActive) {
      filtered = filtered.filter(restaurant => {
        return highlightedRestaurantIds.has(restaurant.slug)
      })
    }

    // Apply legend filters
    if (legendFilters.length > 0) {
      filtered = filtered.filter(restaurant => {
        return legendFilters.some(filterType => {
          switch (filterType) {
            case 'michelin':
              return restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)
            case 'bib':
              return restaurant.michelin_award === 'BIB_GOURMAND'
            case 'nyt':
              return restaurant.nyttop100_rank
            case 'regular':
              return !restaurant.michelin_award && !restaurant.nyttop100_rank
            default:
              return false
          }
        })
      })
    }

    return filtered
  }

  const handleIsochroneRegion = (slugs: string[] | null) => {
    console.log(`🗺️ Setting isochrone region: ${slugs?.length || 0} restaurants`);
    setIsochroneRegionSlugs(slugs);

    // Mark that user has made a query (to auto-expand filter bar)
    if (slugs && slugs.length > 0) {
      setHasUserQueried(true);
    }

    // DON'T automatically highlight - let map actions control highlights
    // This allows backend to distinguish "all in region" vs "filtered subset"
  }

  const handleFilterChange = (filterType: string, values: string[]) => {
    // Special case: "Semantic Search Results" means highlight, not filter
    if (filterType === 'Semantic Search Results') {
      // Backend already scoped the slugs correctly via getScopedSearchPool()
      // No need to re-scope here (avoids async state bugs)
      const newHighlights = new Set(values)
      setHighlightedRestaurantIds(newHighlights)

      // Mark that user has made a query (to auto-expand filter bar)
      if (values.length > 0) {
        setHasUserQueried(true)
      }
      return
    }

    // All other filters work normally (hide restaurants)
    setActiveFilters(prevFilters => {
      const newFilters = { ...prevFilters }
      if (values.length === 0) {
        delete newFilters[filterType]
      } else {
        newFilters[filterType] = values
      }
      return newFilters
    })
  }

  const handleLegendToggle = (filterType: string) => {
    setLegendFilters(prev => {
      if (prev.includes(filterType)) {
        return prev.filter(f => f !== filterType)
      } else {
        return [...prev, filterType]
      }
    })
  }

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant)
  }

  const handleResetAll = () => {
    setActiveFilters({})
    setLegendFilters([])
    setSearchTerm('')
    setSelectedRestaurant(null)
    // Don't reset favoritesActive - preserve favorites mode
    setRestaurantWeekActive(false)
    setHasMenuActive(false)
    setRemisRecsActive(false)
    setHighlightedRestaurantIds(new Set())  // Clear highlights
    previousHighlightedIdsRef.current = new Set()  // Clear saved highlights
    setIsochroneRegionSlugs(null)  // Clear isochrone region

    // Also reset map state (isochrones, view) if the callback is available
    if (mapResetRef.current) {
      mapResetRef.current()
    }
  }

  

  // Apply filters whenever activeFilters or legendFilters change
  useEffect(() => {
    let filtered = restaurants

    // Apply search filter
    if (searchTerm.trim()) {
      filtered = filtered.filter(restaurant =>
        restaurant.name && restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply all filters
    filtered = applyFilters(filtered)
    setFilteredRestaurants(filtered)
  }, [activeFilters, legendFilters, searchTerm, restaurants, restaurantWeekActive, favoritesActive, hasMenuActive, remisRecsActive, favorites, highlightedRestaurantIds])

  return (
    <div className="app">
      <FloatingHeader />

      {/* Filter Bar */}
      <FilterBar
          allRestaurants={restaurants}
          isochroneRegionSlugs={isochroneRegionSlugs}
          onFilterChange={handleFilterChange}
          activeFilters={activeFilters}
          visible={true}
          hasUserQueried={hasUserQueried}
          totalRestaurants={filteredRestaurants.length}
          favoritesCount={favorites.length}
          highlightedCount={highlightedRestaurantIds.size}
          restaurantWeekActive={restaurantWeekActive}
          onRestaurantWeekToggle={handleRestaurantWeekToggle}
          favoritesActive={favoritesActive}
          onFavoritesToggle={handleFavoritesToggle}
          hasMenuActive={hasMenuActive}
          onHasMenuToggle={handleHasMenuToggle}
          remisRecsActive={remisRecsActive}
          onRemisRecsToggle={handleRemisRecsToggle}
        />

      {/* Full Screen Map */}
      <div className="map-section">
        <Map
          restaurants={filteredRestaurants}
          onRestaurantSelect={handleRestaurantSelect}
          activeFilters={legendFilters}
          onLegendFilterChange={handleLegendToggle}
          totalRestaurants={restaurants.length}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onFilterChange={handleFilterChange}
          allRestaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          onResetAll={handleResetAll}
          mapResetRef={mapResetRef}
          highlightedIds={highlightedRestaurantIds}
          onIsochroneRegion={handleIsochroneRegion}
          isochroneRegionSlugs={isochroneRegionSlugs}
          favoritesActive={favoritesActive}
          onFavoritesToggle={handleFavoritesToggle}
        />

        {/* Restaurant Card now appears in chat when clicking markers */}
      </div>


    </div>
  )
}

export default App
