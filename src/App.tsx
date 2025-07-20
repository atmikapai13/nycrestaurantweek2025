import { useState, useEffect } from 'react'
import './App.css'
import type { Restaurant } from './types/restaurant'
import Map from './components/Map'
import Header from './components/Header'
import Filters from './components/Filters'

// Direct import of your restaurant data
import restaurantData from './data/3restaurants_with_characteristics.json'

function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [filteredRestaurants, setFilteredRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filters, setFilters] = useState<Record<string, string[]>>({})

  useEffect(() => {
    // Since we're importing directly, we can use it immediately
    setRestaurants(restaurantData as Restaurant[])
    setFilteredRestaurants(restaurantData as Restaurant[])
    setLoading(false)
  }, [])

  const handleRestaurantSelect = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant)
  }

  const handleSearch = (searchTerm: string) => {
    setSearchTerm(searchTerm)
    applyFilters(searchTerm, filters)
  }

  const handleFilterChange = (filterType: string, values: string[]) => {
    const newFilters = { ...filters, [filterType]: values }
    setFilters(newFilters)
    applyFilters(searchTerm, newFilters)
  }

  const applyFilters = (search: string, filterValues: Record<string, string[]>) => {
    let filtered = restaurants

    // Apply search filter
    if (search.trim()) {
      filtered = filtered.filter(restaurant =>
        restaurant.name.toLowerCase().includes(search.toLowerCase())
      )
    }

    // Apply other filters
    Object.entries(filterValues).forEach(([filterType, values]) => {
      if (values && values.length > 0) {
        switch (filterType) {
          case 'Cuisine':
            filtered = filtered.filter(restaurant =>
              restaurant.cuisine.some(c => values.includes(c))
            )
            break
          case 'Borough':
            filtered = filtered.filter(restaurant =>
              values.includes(restaurant.borough)
            )
            break
          case 'Neighborhood':
            filtered = filtered.filter(restaurant =>
              values.includes(restaurant.neighborhood)
            )
            break
          // Add more filter cases as needed
        }
      }
    })

    setFilteredRestaurants(filtered)
  }

  if (loading) {
    return <div className="loading">Loading restaurant data...</div>
  }

  return (
    <div className="app">
      {/* Header */}
      <Header />

      {/* Main Content */}
      <div className="main-content">
        {/* Map Section (2/3 width) */}
        <div className="map-section">
          <Map 
            restaurants={filteredRestaurants} 
            onRestaurantSelect={handleRestaurantSelect}
          />
        </div>

        {/* Right Section (1/3 width) */}
        <div className="sidebar">
          <Filters 
            onSearch={handleSearch}
            onFilterChange={handleFilterChange}
            restaurantCount={filteredRestaurants.length}
            allRestaurants={restaurants.map(r => r.name)}
          />

          {/* Restaurant Card Section */}
          <div className="restaurant-card-section">
            {selectedRestaurant ? (
              <div className="restaurant-card">
                <h3 className="restaurant-name">{selectedRestaurant.name}</h3>
                <p className="restaurant-borough">{selectedRestaurant.borough}</p>
                <p className="restaurant-cuisine">{selectedRestaurant.cuisine.join(', ')}</p>
                {selectedRestaurant.summary && (
                  <p className="restaurant-summary">{selectedRestaurant.summary}</p>
                )}
                {selectedRestaurant.menu_url && (
                  <a 
                    href={selectedRestaurant.menu_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="menu-link"
                  >
                    View Menu
                  </a>
                )}
              </div>
            ) : (
              <div className="no-selection">
                Select a restaurant on the map to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
