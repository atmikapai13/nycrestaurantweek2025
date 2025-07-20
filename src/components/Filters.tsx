import { useState } from 'react'
import './Filters.css'

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
  allRestaurants: string[]
}

export default function Filters({ onSearch, onFilterChange, restaurantCount, allRestaurants }: FiltersProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string[]>>({})
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Filter options (simplified for now, will be populated from data)
  const filterOptions = {
    'Cuisine': ['All', 'American (New)', 'Italian', 'French', 'Japanese / Sushi'],
    'Borough': ['All', 'Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'],
    'Neighborhood': ['All', 'Midtown East', 'Lower East Side', 'Union Square'],
    'Accessibility': ['All', 'Wheelchair Accessible', 'Hearing Accessible'],
    'Weeks Participating': ['All', 'Week 1', 'Week 2', 'Both Weeks'],
    'Has Menu': ['All', 'Yes', 'No'],
    'Meal Types': ['All', 'Lunch', 'Dinner', 'Both'],
    'Michelin': ['All', 'Yes', 'No'],
    'NYT Top 100': ['All', 'Yes', 'No'],
    'Price': ['All', '$', '$$', '$$$', '$$$$']
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
      .filter(name => 
        name.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .slice(0, 5) // Limit to 5 suggestions
  }

  const handleSuggestionClick = (suggestion: string) => {
    setSearchTerm(suggestion)
    setShowSuggestions(false)
    onSearch(suggestion)
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
            {getSuggestions().map((suggestion, index) => (
              <div
                key={index}
                className="suggestion-item"
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter Buttons */}
      <div className="filter-buttons">
        {Object.entries(filterOptions).map(([filterType, options]) => (
          <div key={filterType} className="filter-group">
            <button
              className="filter-button"
              onClick={() => handleFilterClick(filterType)}
            >
              {filterType}
              <span className="dropdown-arrow">▼</span>
            </button>
            
            {openDropdown === filterType && (
              <div className="dropdown-menu">
                {options.map((option) => {
                  const isSelected = selectedFilters[filterType]?.includes(option) || false
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

      {/* Restaurant Count */}
      <div className="restaurant-count">
        {restaurantCount} restaurants
      </div>
    </div>
  )
} 