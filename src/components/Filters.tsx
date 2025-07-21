import { useState } from 'react'
import './Filters.css'
import type { Restaurant } from '../types/restaurant'

interface FilterOption {
  label: string
  count: number
  id: string
  slug: string
}

interface FiltersProps {
  onSearch: (searchTerm: string) => void
  onFilterChange: (filterType: string, values: string[]) => void
  restaurantCount: number
  allRestaurants: Restaurant[]
  onResetAll: () => void
  onRestaurantSelect: (restaurant: Restaurant) => void
}

export default function Filters({ onSearch, onFilterChange, restaurantCount, allRestaurants = [], onResetAll, onRestaurantSelect}: FiltersProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string[]>>({})
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [hasMenuActive, setHasMenuActive] = useState(false)
  

  // Filter options (simplified for now, will be populated from data)
  const filterOptions = {
    'Cuisine': ['Mexican', 'American (Traditional)', 'Steakhouse', 'French', 'Italian', 'Thai', 'Asian Fusion', 'Indian', 'American (New)', 'Japanese / Sushi', 'Chinese', 'Seafood', 'Caribbean', 'Mediterranean', 'Spanish', 'Austrian', 'Gastropub', 'Eclectic', 'Cuban', 'Belgian', 'Puerto Rican', 'Argentinian', 'Taiwanese', 'Greek', 'Eastern European', 'Latin American', 'Middle Eastern', 'Barbecue', 'Ukrainian', 'Brazilian', 'Korean', 'Peruvian', 'Turkish', 'Hawaiian', 'Pan-Asian', 'British', 'Continental', 'Vietnamese', 'Irish', 'Cajun/Creole', 'Soul Food / Southern', 'African', 'Colombian', 'Pizza'],
    'Weeks Participating': ['Week 1 (July 21 - July 27)', 'Week 2 (July 28 - Aug 3)', 'Week 3 (Aug 4 - Aug 10)', 'Week 4 (Aug 11 - Aug 17)', 'Week 5 (Aug 18 - Aug 24)', 'Week 6 (Aug 25 - Aug 31)'],
    'Meal Types': ['$30 Lunch Price', '$60 Dinner Price', '$45 Dinner Price', '$30 Sunday Lunch/Brunch Price', '$45 Sunday Dinner Price', '$45 Lunch Price', '$60 Sunday Dinner Price', '$30 Dinner Price', '$30 Sunday Dinner Price', '$45 Sunday Lunch/Brunch Price', '$60 Lunch Price', '$60 Sunday Lunch/Brunch Price'],
    'NYT Top 100': ['Yes', 'No'],
    'Accessibility': ['Wheelchair Accessible', 'Hearing Accessible'],
    'Collections' : ['around-the-boroughs', 'date-night', 'summer-vibes', 'celebrity-chefs', 'dress-for-the-occasion', 'classic-restaurants', 'hidden-gems', 'for-the-foodies']
  }

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchTerm(value)
    setShowSuggestions(value.length > 0)
    onSearch(value)
  }

  const getSuggestions = () => {
    if (!searchTerm.trim()) return []
    return allRestaurants
      .filter(restaurant => 
        restaurant.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .slice(0, 5) // Limit to 5 suggestions
  }

  const handleSuggestionClick = (restaurant: Restaurant) => {
    setSearchTerm(restaurant.name)
    setShowSuggestions(false)
    onSearch(restaurant.name)
    onRestaurantSelect(restaurant)
  }

  const handleFilterClick = (filterType: string) => {
    setOpenDropdown(openDropdown === filterType ? null : filterType)
  }

  const handleFilterSelect = (filterType: string, value: string) => {
    const currentSelected = selectedFilters[filterType] || []
    let newSelected: string[]
    
    if (value === 'All') {
      newSelected = []
    } else if (currentSelected.includes(value)) {
      newSelected = currentSelected.filter(v => v !== value)
    } else {
      newSelected = [...currentSelected, value]
    }
    
    const newFilters = { ...selectedFilters, [filterType]: newSelected }
    setSelectedFilters(newFilters)
    onFilterChange(filterType, newSelected)
    setOpenDropdown(null)
  }

  const handleRemoveFilter = (filterType: string, value: string) => {
    const currentSelected = selectedFilters[filterType] || []
    const newSelected = currentSelected.filter(v => v !== value)
    
    const newFilters = { ...selectedFilters, [filterType]: newSelected }
    setSelectedFilters(newFilters)
    onFilterChange(filterType, newSelected)
  }

  const handleHasMenuToggle = () => {
    const newActive = !hasMenuActive
    setHasMenuActive(newActive)
    onFilterChange('Has Menu', newActive ? ['active'] : [])
  }

  const handleResetAll = () => {
    console.log('Resetting all filters...')
    // Clear local state
    setSearchTerm('')
    setSelectedFilters({})
    setHasMenuActive(false)
    
    // Call the parent reset function
    onResetAll()
  }

  // Get all applied filters for display
  const getAppliedFilters = () => {
    const applied: Array<{filterType: string, value: string}> = []
    Object.entries(selectedFilters).forEach(([filterType, values]) => {
      values.forEach(value => {
        applied.push({ filterType, value })
      })
    })
    return applied
  }

  const appliedFilters = getAppliedFilters()

  return (
    <div className="filters-container">
      {/* Header */}
      <div className="filters-header">
        <h2 className="filters-title">Browse All Restaurants</h2>
      </div>

      {/* Search Bar */}
      <div className="search-container">
        <input
          type="text"
          placeholder="Search"
          value={searchTerm}
          onChange={handleSearch}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className="search-input"
        />
        <div className="search-icon">🔍</div>
        
        {/* Search Suggestions */}
        {showSuggestions && getSuggestions().length > 0 && (
          <div className="search-suggestions">
            {getSuggestions().map((restaurant, index) => (
              <div
                key={index}
                className="suggestion-item"
                onClick={() => handleSuggestionClick(restaurant)}
              >
                {restaurant.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter Buttons */}
      <div className="filter-buttons">
        {/* Has Menu Toggle Button */}
        <div className="filter-group">
          <button
            className={`filter-button ${hasMenuActive ? 'active' : ''}`}
            onClick={handleHasMenuToggle}
          >
            Has Menu
          </button>
        </div>
        

        
        {/* Regular Dropdown Filters */}
        {Object.entries(filterOptions).map(([filterType, options]) => (
          <div key={filterType} className="filter-group">
            <button
              className="filter-button"
              onClick={() => handleFilterClick(filterType)}
            >
              {filterType}
              <span className="dropdown-arrow">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                  <path d="M5 8L10 13L15 8" stroke="black" strokeWidth="2.1" />
                </svg>
              </span>
            </button>
            
            {openDropdown === filterType && (
              <div className="dropdown-menu">
                {options.map((option) => {
                  const currentSelected = selectedFilters[filterType] || []
                  const isSelected = option === 'All' 
                    ? currentSelected.length === 0 
                    : currentSelected.includes(option)
                  return (
                    <div
                      key={option}
                      className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleFilterSelect(filterType, option)}
                    >
                      <span className="checkbox">
                        {isSelected ? '☑' : '☐'}
                      </span>
                      {option}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Applied Filters */}
      {appliedFilters.length > 0 && (
        <div className="applied-filters-container">
          <h3>Applied Filters</h3>
          <div className="applied-filters">
            {appliedFilters.map((filter, index) => (
              <span key={index} className="applied-filter-tag">
                {filter.value}
                <button
                  className="remove-filter-button"
                  onClick={() => handleRemoveFilter(filter.filterType, filter.value)}
                >
                  ×
                </button>
              </span>
            ))}
            <button className="reset-all-button" onClick={handleResetAll}>
              RESET ALL ×
            </button>
          </div>
        </div>
      )}

      {/* Restaurant Count */}
      <div className="restaurant-count">
        {restaurantCount} restaurants
      </div>
    </div>
  )
} 