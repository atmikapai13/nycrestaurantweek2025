import { useState } from 'react'
import './Filters.css'
import type { Restaurant } from '../types/restaurant'



interface FiltersProps {
  onSearch: (searchTerm: string) => void
  onFilterChange: (filterType: string, values: string[]) => void
  restaurantCount: number
  allRestaurants: Restaurant[]
  onResetAll: () => void
  onRestaurantSelect: (restaurant: Restaurant) => void
  favorites: string[]
  onFavoritesToggle: () => void
  favoritesActive: boolean
}

export default function Filters({ onSearch, onFilterChange, allRestaurants = [], onResetAll, onRestaurantSelect, favorites, onFavoritesToggle, favoritesActive}: FiltersProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string[]>>({})
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [hasMenuActive, setHasMenuActive] = useState(false)
  

  // Filter options (simplified for now, will be populated from data)
  const filterOptions = {
    'Cuisine': ['Mexican', 'American (Traditional)', 'Steakhouse', 'French', 'Italian', 'Thai', 'Asian Fusion', 'Indian', 'American (New)', 'Japanese / Sushi', 'Chinese', 'Seafood', 'Caribbean', 'Mediterranean', 'Spanish', 'Austrian', 'Gastropub', 'Eclectic', 'Cuban', 'Belgian', 'Puerto Rican', 'Argentinian', 'Taiwanese', 'Greek', 'Eastern European', 'Latin American', 'Middle Eastern', 'Barbecue', 'Ukrainian', 'Brazilian', 'Korean', 'Peruvian', 'Turkish', 'Hawaiian', 'Pan-Asian', 'British', 'Continental', 'Vietnamese', 'Irish', 'Cajun/Creole', 'Soul Food / Southern', 'African', 'Colombian', 'Pizza'],
    'Meal Types': ['$30 Lunch Price', '$60 Dinner Price', '$45 Dinner Price', '$30 Sunday Lunch/Brunch Price', '$45 Sunday Dinner Price', '$45 Lunch Price', '$60 Sunday Dinner Price', '$30 Dinner Price', '$30 Sunday Dinner Price', '$45 Sunday Lunch/Brunch Price', '$60 Lunch Price', '$60 Sunday Lunch/Brunch Price'],
    'Collections' : ['around-the-boroughs', 'date-night', 'summer-vibes', 'celebrity-chefs', 'dress-for-the-occasion', 'classic-restaurants', 'hidden-gems', 'for-the-foodies'],
    'Participating Weeks': ['Week 1 (July 21 - July 27)', 'Week 2 (July 28 - Aug 3)', 'Week 3 (Aug 4 - Aug 10)', 'Week 4 (Aug 11 - Aug 17)', 'Week 5 (Aug 18 - Aug 24)', 'Week 6 (Aug 25 - Aug 31)']
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

  // Helper to format collection names for display
  const formatCollectionName = (name: string) =>
    name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

  return (
    <div className="filters-container">
      {/* Header */}
      <div className="filters-header">
        <h2 className="filters-title">Browse All Restaurants</h2>
        <p className="filters-instructions">To learn more about restaurant offerings, tap on a pin in the map or search for one below:</p>
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
        {/* Regular Dropdown Filters */}
        {Object.entries(filterOptions).map(([filterType, options]) => {
          const hasSelectedItems = selectedFilters[filterType] && selectedFilters[filterType].length > 0
          return (
            <div key={filterType} className="filter-group">
              <button
                className={`filter-button ${hasSelectedItems ? 'active' : ''}`}
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
                  // Use formatted display for Collections
                  const displayText = filterType === 'Collections' ? formatCollectionName(option) : option
                  return (
                    <div
                      key={option}
                      className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleFilterSelect(filterType, option)}
                    >
                      <span className="checkbox">
                        {isSelected ? '☑' : '☐'}
                      </span>
                      {displayText}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
        })}

        {/* Has Menu Toggle Button */}
        <div className="filter-group">
          <button
            className={`filter-button ${hasMenuActive ? 'active' : ''}`}
            onClick={handleHasMenuToggle}
          >
            Has Menu
          </button>
        </div>

        {/* Reset All Button - Only show when filters are applied */}
        {appliedFilters.length > 0 && (
          <div className="filter-group">
            <button
              className="filter-button reset-all-button"
              onClick={handleResetAll}
            >
              RESET ALL ×
            </button>
          </div>
        )}

        {/* Favorites Button - Right aligned */}
        <div className="filter-group favorites-filter">
          <button
            className={`filter-button ${favoritesActive ? 'active' : ''}`}
            onClick={onFavoritesToggle}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={favoritesActive ? "#FF69B4" : "none"} stroke="#FF69B4" strokeWidth="2" style={{ marginRight: '4px' }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            {favorites.length} Favorites
          </button>
        </div>
      </div>

    </div>
  )
} 