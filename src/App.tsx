import { useState, useEffect } from 'react'
import './App.css'
import type { Restaurant } from './types/restaurant'
import Map from './components/Map'
import Header from './components/Header'
import Filters from './components/Filters'
import Footer from './components/Footer'

// Direct import of your restaurant data
import restaurantData from './data/NYCRestaurantWeek/4_JoinMichelin.json'

function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [filteredRestaurants, setFilteredRestaurants] = useState<Restaurant[]>([])
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
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
    console.log(`handleFilterChange called with: ${filterType} =`, values)
    
    // If this is a reset (empty array) and we have other filters, 
    // check if this is part of a "reset all" operation
    if (values.length === 0 && Object.keys(filters).length > 0) {
      console.log('Detected potential reset operation')
    }
    
    const newFilters = { ...filters, [filterType]: values }
    console.log('newFilters object:', newFilters)
    setFilters(newFilters)
    // Use the newFilters object directly to ensure we have the latest values
    applyFilters(searchTerm, newFilters)
  }

  const applyFilters = (search: string, filterValues: Record<string, string[]>) => {
    let filtered = restaurants
    console.log('applyFilters called with:', { search, filterValues })

    // Apply search filter
    if (search.trim()) {
      filtered = filtered.filter(restaurant =>
        restaurant.name.toLowerCase().includes(search.toLowerCase())
      )
      console.log('After search filter:', filtered.length)
    }

    // Apply other filters
    Object.entries(filterValues).forEach(([filterType, values]) => {
      if (values && values.length > 0) {
        console.log(`Applying ${filterType} filter with values:`, values)
        switch (filterType) {
          case 'Cuisine':
            filtered = filtered.filter(restaurant =>
              values.includes(restaurant.cuisine)
            )
            break
          case 'Weeks Participating':
            filtered = filtered.filter(restaurant =>
              restaurant.participation_weeks.some(week => values.includes(week))
            )
            break
          case 'Meal Types':
            filtered = filtered.filter(restaurant =>
              restaurant.meal_types.some(meal => values.includes(meal))
            )
            break
          case 'Has Menu':
            filtered = filtered.filter(restaurant => {
              const menuUrl = restaurant.menu_url || '';
              return menuUrl.trim() !== '' && menuUrl.toLowerCase() !== 'na';
            })
            break
          case 'Michelin Star':
            filtered = filtered.filter(restaurant => {
              const award = restaurant.michelin_award || '';
              return ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(award);
            })
            break
          case 'Bib Gourmand':
            filtered = filtered.filter(restaurant => {
              const award = restaurant.michelin_award || '';
              return award === 'BIB_GOURMAND';
            })
            break
          // Add more filter cases as needed
        }
        console.log(`After ${filterType} filter:`, filtered.length)
      }
    })

    console.log('Final filtered count:', filtered.length)
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
        </div>
      </div>
      {/* Footer - Add it here */}
      <Footer />
    </div>
  )
}

export default App
