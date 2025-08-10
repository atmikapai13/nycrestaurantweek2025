import { useEffect, useRef, useState } from 'react'
import type { Restaurant } from '../types/restaurant'

interface OfflineMapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilters: string[]
  onLegendFilterChange: (filterType: string) => void
  favorites: string[]
  isOnline: boolean
}

export default function OfflineMap({ 
  restaurants, 
  onRestaurantSelect, 
  activeFilters, 
  onLegendFilterChange, 
  favorites, 
  isOnline 
}: OfflineMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)

  // Calculate NYC bounds for our coordinate system
  const NYC_BOUNDS = {
    minLat: 40.4774,
    maxLat: 40.9176,
    minLng: -74.2591,
    maxLng: -73.7004
  }

  // Convert lat/lng to pixel coordinates
  const latLngToPixel = (lat: number, lng: number, containerWidth: number, containerHeight: number) => {
    const x = ((lng - NYC_BOUNDS.minLng) / (NYC_BOUNDS.maxLng - NYC_BOUNDS.minLng)) * containerWidth
    const y = ((NYC_BOUNDS.maxLat - lat) / (NYC_BOUNDS.maxLat - NYC_BOUNDS.minLat)) * containerHeight
    return { x: Math.max(0, Math.min(containerWidth, x)), y: Math.max(0, Math.min(containerHeight, y)) }
  }

  // Get marker color based on restaurant type
  const getMarkerColor = (restaurant: Restaurant) => {
    if (restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)) {
      return '#C81224' // Michelin red
    }
    if (restaurant.michelin_award === 'BIB_GOURMAND') {
      return '#f9a83d' // Bib Gourmand orange
    }
    if (restaurant.nyttop100_rank) {
      return '#FF69B4' // NYT pink
    }
    return '#000000' // Regular black
  }

  // Filter restaurants based on active filters
  const filteredRestaurants = restaurants.filter(restaurant => {
    if (activeFilters.length === 0) return true
    
    return activeFilters.some(filterType => {
      switch (filterType) {
        case 'michelin':
          return restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)
        case 'bib':
          return restaurant.michelin_award === 'BIB_GOURMAND'
        case 'nyt':
          return restaurant.nyttop100_rank
        case 'regular':
          return !restaurant.michelin_award && !restaurant.nyttop100_rank
        case 'favorites':
          return favorites.includes(restaurant.name)
        default:
          return false
      }
    })
  })

  const handleLegendClick = (filterType: string) => {
    onLegendFilterChange(filterType)
  }

  const handleMarkerClick = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant)
    onRestaurantSelect(restaurant)
  }

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="offline-map-container">
        {!isOnline && (
          <div className="offline-banner">
            <div className="offline-message">
              📍 Map offline - Showing restaurant locations
            </div>
          </div>
        )}
        
        {/* NYC Borough boundaries (simplified SVG) */}
        <svg 
          viewBox="0 0 800 600" 
          className="offline-map-svg"
          style={{ width: '100%', height: '100%', background: '#f0f0f0' }}
        >
          {/* Manhattan outline */}
          <path 
            d="M380 100 L420 120 L430 200 L440 300 L430 400 L420 450 L400 480 L380 460 L370 400 L360 300 L370 200 L380 100 Z" 
            fill="#e8e8e8" 
            stroke="#ccc" 
            strokeWidth="1"
          />
          {/* Brooklyn outline */}
          <path 
            d="M430 400 L480 420 L520 440 L540 480 L520 520 L480 540 L440 520 L420 480 L430 400 Z" 
            fill="#e8e8e8" 
            stroke="#ccc" 
            strokeWidth="1"
          />
          {/* Queens outline */}
          <path 
            d="M440 300 L500 320 L560 340 L580 380 L540 420 L480 400 L440 380 L440 300 Z" 
            fill="#e8e8e8" 
            stroke="#ccc" 
            strokeWidth="1"
          />
          {/* Bronx outline */}
          <path 
            d="M380 100 L420 80 L460 100 L480 140 L460 180 L420 160 L380 140 L380 100 Z" 
            fill="#e8e8e8" 
            stroke="#ccc" 
            strokeWidth="1"
          />
          {/* Staten Island outline */}
          <path 
            d="M280 480 L320 500 L340 540 L320 580 L280 560 L260 520 L280 480 Z" 
            fill="#e8e8e8" 
            stroke="#ccc" 
            strokeWidth="1"
          />

          {/* Borough labels */}
          <text x="400" y="280" textAnchor="middle" fontSize="14" fill="#666" fontWeight="bold">Manhattan</text>
          <text x="480" y="480" textAnchor="middle" fontSize="14" fill="#666" fontWeight="bold">Brooklyn</text>
          <text x="520" y="360" textAnchor="middle" fontSize="14" fill="#666" fontWeight="bold">Queens</text>
          <text x="420" y="140" textAnchor="middle" fontSize="14" fill="#666" fontWeight="bold">Bronx</text>
          <text x="300" y="530" textAnchor="middle" fontSize="12" fill="#666" fontWeight="bold">Staten I.</text>

          {/* Restaurant markers */}
          {filteredRestaurants.map((restaurant, index) => {
            if (!restaurant.latitude || !restaurant.longitude) return null
            
            const { x, y } = latLngToPixel(restaurant.latitude, restaurant.longitude, 800, 600)
            const color = getMarkerColor(restaurant)
            const isFavorite = favorites.includes(restaurant.name)
            
            return (
              <g key={`${restaurant.name}-${index}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isFavorite ? "8" : "6"}
                  fill={color}
                  stroke="white"
                  strokeWidth="2"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleMarkerClick(restaurant)}
                />
                {isFavorite && (
                  <text
                    x={x}
                    y={y + 2}
                    textAnchor="middle"
                    fontSize="8"
                    fill="white"
                    style={{ cursor: 'pointer', pointerEvents: 'none' }}
                  >
                    ♥
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Map Legend */}
      <div className="map-legend">
        <h4 style={{ color: '#000000', margin: '0 0 -7px 0' }}>{filteredRestaurants.length} Restaurants</h4>
        <div style={{ fontSize: 'clamp(6px, 0.8vw, 12px)', color: '#666', marginBottom: '0px', marginTop: '0px' }}>Click on list below:</div>
        <div className="legend-list-vertical">
          <div 
            className="legend-item" 
            onClick={() => handleLegendClick('michelin')}
            style={{ cursor: 'pointer' }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#C81224' }}></div>
            <img src="MichelinStar.svg.png" alt="Michelin Star" style={{ width: 'clamp(10px, 1.2vw, 16px)', height: 'clamp(10px, 1.2vw, 16px)', marginRight: '2px', verticalAlign: 'middle' }} />
            <span style={{ fontWeight: activeFilters.includes('michelin') ? 'bold' : 'normal', color: '#000000' }}>Michelin</span>
            {activeFilters.includes('michelin') && (
              <button 
                onClick={(e) => { e.stopPropagation(); handleLegendClick('michelin'); }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#666', 
                  cursor: 'pointer', 
                  fontSize: 'clamp(6px, 0.8vw, 12px)',
                  padding: '0',
                  marginLeft: '2px'
                }}
              >
                ×
              </button>
            )}
          </div>
          <div 
            className="legend-item" 
            onClick={() => handleLegendClick('bib')}
            style={{ cursor: 'pointer' }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#f9a83d' }}></div>
            <img src="bibgourmand.png" alt="Bib Gourmand" style={{ width: 'clamp(10px, 1.2vw, 16px)', height: 'clamp(10px, 1.2vw, 16px)', marginRight: '2px', verticalAlign: 'middle' }} />
            <span style={{ fontWeight: activeFilters.includes('bib') ? 'bold' : 'normal', color: '#000000' }}>Bib Gourmand</span>
            {activeFilters.includes('bib') && (
              <button 
                onClick={(e) => { e.stopPropagation(); handleLegendClick('bib'); }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#666', 
                  cursor: 'pointer', 
                  fontSize: 'clamp(6px, 0.8vw, 12px)',
                  padding: '0',
                  marginLeft: '2px'
                }}
              >
                ×
              </button>
            )}
          </div>
          <div 
            className="legend-item" 
            onClick={() => handleLegendClick('nyt')}
            style={{ cursor: 'pointer' }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#FF69B4' }}></div>
            <img src="nytimes.png" alt="NYT Top 100" style={{ width: 'clamp(10px, 1.2vw, 16px)', height: 'clamp(10px, 1.2vw, 16px)', marginRight: '2px', verticalAlign: 'middle' }} />
            <span style={{ fontWeight: activeFilters.includes('nyt') ? 'bold' : 'normal', color: '#000000' }}>NYT Top 100</span>
            {activeFilters.includes('nyt') && (
              <button 
                onClick={(e) => { e.stopPropagation(); handleLegendClick('nyt'); }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#666', 
                  cursor: 'pointer', 
                  fontSize: 'clamp(6px, 0.8vw, 12px)',
                  padding: '0',
                  marginLeft: '2px'
                }}
              >
                ×
              </button>
            )}
          </div>
          <div 
            className="legend-item" 
            onClick={() => handleLegendClick('regular')}
            style={{ cursor: 'pointer' }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#000000' }}></div>
            <span style={{ fontWeight: activeFilters.includes('regular') ? 'bold' : 'normal', color: '#000000' }}>The Rest</span>
            {activeFilters.includes('regular') && (
              <button 
                onClick={(e) => { e.stopPropagation(); handleLegendClick('regular'); }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#666', 
                  cursor: 'pointer', 
                  fontSize: 'clamp(6px, 0.8vw, 12px)',
                  padding: '0',
                  marginLeft: '2px'
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}