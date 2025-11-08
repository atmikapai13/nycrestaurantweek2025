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
  
  const [activeBadges, setActiveBadges] = useState<string[]>([])
  

  // Filter options (simplified for now, will be populated from data)
  const filterOptions = {
    'Cuisine': ['Mexican', 'American (Traditional)', 'Steakhouse', 'French', 'Italian', 'Thai', 'Asian Fusion', 'Indian', 'American (New)', 'Japanese / Sushi', 'Chinese', 'Seafood', 'Caribbean', 'Mediterranean', 'Spanish', 'Austrian', 'Gastropub', 'Eclectic', 'Cuban', 'Belgian', 'Puerto Rican', 'Argentinian', 'Taiwanese', 'Greek', 'Eastern European', 'Latin American', 'Middle Eastern', 'Barbecue', 'Ukrainian', 'Brazilian', 'Korean', 'Peruvian', 'Turkish', 'Hawaiian', 'Pan-Asian', 'British', 'Continental', 'Vietnamese', 'Irish', 'Cajun/Creole', 'Soul Food / Southern', 'African', 'Colombian', 'Pizza'],
    'Price': ['$', '$$', '$$$', '$$$$'],
    'Yelp Rating': ['3.5', '4', '4.5'],
    'Vibes' : ['around-the-boroughs', 'date-night', 'summer-vibes', 'celebrity-chefs', 'dress-for-the-occasion', 'classic-restaurants', 'hidden-gems', 'for-the-foodies']
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

  

  const toggleBadge = (badge: 'michelin' | 'bib' | 'nyt') => {
    const isActive = activeBadges.includes(badge)
    const next = isActive ? activeBadges.filter(b => b !== badge) : [...activeBadges, badge]
    setActiveBadges(next)
    onFilterChange('Badges', next)
  }

  const handleResetAll = () => {
    console.log('Resetting all filters...')
    // Clear local state
    setSearchTerm('')
    setSelectedFilters({})
    setActiveBadges([])
    onFilterChange('Badges', [])
    
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

  // Helper function to copy text to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Favorites link copied to clipboard!')
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      alert('Favorites link copied to clipboard!')
    })
  }

  return (
    <div className="filters-container">
      {/* Header */}
      <div className="filters-header">
        <h2 className="filters-title">Browse restaurants</h2>
        <div className="filters-subrow">
          <p className="filters-instructions">To learn more about restaurant offerings, tap on a pin in the map or chat with Remi the restaurant concierge:</p>
        </div>
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
                  // Use formatted display for Vibes
                  const displayText = filterType === 'Vibes' ? formatCollectionName(option) : option
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

        

        {/* Badge Toggles */}
        <div className="filter-group">
          <button
            className={`filter-button ${activeBadges.includes('michelin') ? 'active' : ''}`}
            onClick={() => toggleBadge('michelin')}
          >
            <span className="legend-dot" style={{ backgroundColor: '#d81b60', display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', marginRight: '8px' }} />
            <img src="/MichelinStar.svg.png" alt="Michelin" style={{ height: '14px', marginRight: '6px' }} />
            Michelin
          </button>
        </div>

        <div className="filter-group">
          <button
            className={`filter-button ${activeBadges.includes('bib') ? 'active' : ''}`}
            onClick={() => toggleBadge('bib')}
          >
            <span className="legend-dot" style={{ backgroundColor: '#ffa000', display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', marginRight: '8px' }} />
            <img src="/bibgourmand.png" alt="Bib Gourmand" style={{ height: '14px', marginRight: '6px' }} />
            Bib Gourmand
          </button>
        </div>

        <div className="filter-group">
          <button
            className={`filter-button ${activeBadges.includes('nyt') ? 'active' : ''}`}
            onClick={() => toggleBadge('nyt')}
          >
            <span className="legend-dot" style={{ backgroundColor: '#ff66b2', display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', marginRight: '8px' }} />
            <img src="/nytimes.png" alt="NYT Top 100" style={{ height: '14px', marginRight: '6px' }} />
            NYT Top 100
          </button>
        </div>

        {/* Reset All Button - Only show when filters are applied (before favorites) */}
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

        {/* Favorites Button - Right aligned within filter row */}
        <div className="filter-group favorites-filter">
          <button
            className={`filter-button ${favoritesActive ? 'active' : ''}`}
            onClick={onFavoritesToggle}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={favoritesActive ? "#FF69B4" : "none"} stroke="#FF69B4" strokeWidth="2" style={{ marginRight: '4px' }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            {favorites.length}
          </button>
        </div>

        {/* Share Favorites Dropdown - Only show when there are favorites */}
        {favorites.length > 0 && (
          <div className="filter-group share-dropdown">
            <button
              className="filter-button share-button"
              onClick={() => setOpenDropdown(openDropdown === 'share' ? null : 'share')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16,6 12,2 8,6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Share
              <span className="dropdown-arrow">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                  <path d="M5 8L10 13L15 8" stroke="currentColor" strokeWidth="2.1" />
                </svg>
              </span>
            </button>
            
            {openDropdown === 'share' && (
              <div className="dropdown-menu share-dropdown-menu">
                <div
                  className="dropdown-item"
                  onClick={() => {
                    const currentUrl = window.location.origin + window.location.pathname
                    const favoriteSlugs = favorites.map(name => 
                      allRestaurants.find(r => r.name === name)?.slug
                    ).filter((slug): slug is string => slug !== undefined)
                    const shareUrl = `${currentUrl}#favorites=${encodeURIComponent(favoriteSlugs.join(','))}`
                    
                    if (navigator.share) {
                      navigator.share({
                        title: 'My NYC Restaurant Week Favorites',
                        text: `Check out my ${favorites.length} favorite restaurants for NYC Restaurant Week!`,
                        url: shareUrl
                      }).catch((error) => {
                        console.log('Share cancelled or failed:', error)
                        copyToClipboard(shareUrl)
                      })
                    } else {
                      copyToClipboard(shareUrl)
                    }
                    setOpenDropdown(null)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  Share with friends
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => {
                    const restaurantNames = favorites.map(name => {
                      const restaurant = allRestaurants.find(r => r.name === name)
                      if (restaurant) {
                        const searchQuery = restaurant.address 
                          ? `${restaurant.name}, ${restaurant.address}`
                          : restaurant.name
                        return encodeURIComponent(searchQuery)
                      }
                      return null
                    }).filter((query): query is string => query !== null)
                    
                    if (restaurantNames.length > 0) {
                      const googleMapsUrl = `https://www.google.com/maps/dir/${restaurantNames.join('/')}`
                      window.open(googleMapsUrl, '_blank')
                    }
                    
                    setOpenDropdown(null)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  Export to Google Maps
                </div>
              </div>
            )}
          </div>
        )}

        
      </div>

    </div>
  )
} 