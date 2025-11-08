import { useState, useEffect, useRef } from 'react'
import './App.css'
import Header from './components/Header'
import Map from './components/Map'
import Filters from './components/Filters'
import RestaurantCard from './components/RestaurantCard'
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
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null)

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

  const handleSearch = (searchTerm: string) => {
    setSearchTerm(searchTerm)
    let filtered = restaurants

    // Apply search filter
    if (searchTerm.trim()) {
      filtered = filtered.filter(restaurant =>
        restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply other filters
    filtered = applyFilters(filtered)
    setFilteredRestaurants(filtered)
  }

  const applyFilters = (restaurantsToFilter: Restaurant[]) => {
    let filtered = restaurantsToFilter

    // Apply favorites filter first
    if (favoritesActive) {
      filtered = filtered.filter(restaurant => favorites.includes(restaurant.name))
    }

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
              return values.some(meal => restaurant.meal_types.includes(meal))
            case 'Price':
              // Prefer v2 `price` if present, otherwise fall back to `price_range`
              return values.includes((restaurant as any).price ?? restaurant.price_range)
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
              return values.some(collection => restaurant.collections.includes(collection))
            case 'Badges': {
              // OR logic: match if restaurant has ANY of the selected badges
              return values.some((badge) => {
                switch (badge) {
                  case 'michelin':
                    return restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)
                  case 'bib':
                    return restaurant.michelin_award === 'BIB_GOURMAND'
                  case 'nyt':
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
              return values.some(keyword => highlights.includes(keyword.toLowerCase()))
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

  const handleFilterChange = (filterType: string, values: string[]) => {
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
    setFavoritesActive(false)
  }

  const handleMapFocus = (restaurantIds: string[]) => {
    // Focus map on these restaurants
    if (mapInstanceRef.current && restaurantIds.length > 0) {
      const focusedRestaurants = restaurants.filter(r =>
        restaurantIds.includes(r.slug) && r.latitude && r.longitude
      )

      if (focusedRestaurants.length === 1) {
        // Single restaurant - fly to it
        const r = focusedRestaurants[0]
        mapInstanceRef.current.flyTo({
          center: [r.longitude!, r.latitude!],
          zoom: 14,
          duration: 1500
        })
      } else if (focusedRestaurants.length > 1) {
        // Multiple restaurants - fit bounds
        const coordinates = focusedRestaurants.map(r => [r.longitude!, r.latitude!])
        const lngs = coordinates.map(c => c[0])
        const lats = coordinates.map(c => c[1])

        mapInstanceRef.current.fitBounds([
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        ], {
          padding: 80,
          duration: 1500,
          maxZoom: 13
        })
      }
    }
  }

  // Apply filters whenever activeFilters or legendFilters change
  useEffect(() => {
    let filtered = restaurants

    // Apply search filter
    if (searchTerm.trim()) {
      filtered = filtered.filter(restaurant =>
        restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply all filters
    filtered = applyFilters(filtered)
    setFilteredRestaurants(filtered)
  }, [activeFilters, legendFilters, searchTerm, restaurants, favorites, favoritesActive])

  return (
    <div className="app">
      {/* Header */}
      <Header />

      {/* Filter Bar - Top, 80% width, centered */}
      <div className="filter-bar-container">
        <div className="filter-bar">
          <Filters 
            onSearch={handleSearch}
            onFilterChange={handleFilterChange}
            restaurantCount={filteredRestaurants.length}
            allRestaurants={restaurants}
            onResetAll={handleResetAll}
            onRestaurantSelect={handleRestaurantSelect}
            favorites={favorites}
            onFavoritesToggle={handleFavoritesToggle}
            favoritesActive={favoritesActive}
          />
        </div>
      </div>

      {/* Map Section - Full width with padding */}
      <div className="map-section">
        <Map
          restaurants={filteredRestaurants}
          onRestaurantSelect={handleRestaurantSelect}
          activeFilters={legendFilters}
          onLegendFilterChange={handleLegendToggle}
          totalRestaurants={restaurants.length}
          favorites={favorites}
          onFilterChange={handleFilterChange}
          allRestaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
        />

        {/* Restaurant Card Overlay - Bottom Right */}
        {selectedRestaurant && (
          <div className="restaurant-card-overlay">
            <RestaurantCard
              restaurant={selectedRestaurant}
              onClose={() => setSelectedRestaurant(null)}
              isFavorited={favorites.includes(selectedRestaurant.name)}
              onToggleFavorite={() => toggleFavorite(selectedRestaurant.name)}
            />
          </div>
        )}
      </div>


    </div>
  )
}

export default App
