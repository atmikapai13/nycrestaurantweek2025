import type { Restaurant } from '../types/restaurant'

interface MapLegendProps {
  // Counts
  allRestaurants: Restaurant[]
  isochroneRegionSlugs?: string[] | null
  highlightedIds?: Set<string>
  highlightedCount: number
  awardWinnersCount: number
  favoritesCount: number
  restaurantCount: number

  // Active states (all optional to match Map.tsx)
  highlightedActive?: boolean
  awardsActive?: boolean
  favoritesActive?: boolean

  // Callbacks (all optional to match Map.tsx)
  onHighlightedToggle?: () => void
  onAwardsToggle?: () => void
  onFavoritesToggle?: () => void

  // Mobile filter toggle
  isMobileFilterExpanded?: boolean
  onMobileFilterToggle?: () => void

  // Optional className for responsive hiding
  className?: string
}

export const MapLegend: React.FC<MapLegendProps> = ({
  allRestaurants,
  isochroneRegionSlugs,
  highlightedIds,
  highlightedCount,
  awardWinnersCount,
  favoritesCount,
  restaurantCount,
  highlightedActive = false,
  awardsActive = false,
  favoritesActive = false,
  onHighlightedToggle,
  onAwardsToggle,
  onFavoritesToggle,
  isMobileFilterExpanded = true,
  onMobileFilterToggle
}) => {
  return (
    <div className={`map-legend ${!isMobileFilterExpanded ? 'legend-standalone' : ''}`}>
      <div className="legend-content">
        <h4 style={{ color: '#000000', margin: '0 0 -4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Remi's picks</span>
          {onMobileFilterToggle && (
            <button
              className="legend-toggle-button"
              onClick={onMobileFilterToggle}
              aria-label={isMobileFilterExpanded ? "Collapse filters" : "Expand filters"}
            >
              {isMobileFilterExpanded ? '−' : '+'}
            </button>
          )}
        </h4>

        {/* Legend items */}
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-marker" style={{ backgroundColor: '#7c7c7c', width: '8px', height: '8px' }}></div>
            <span>
              <span className="legend-count">{restaurantCount} </span>
              {isochroneRegionSlugs ? 'in Isochrone' : 'Restaurants'}
            </span>
          </div>

          {/* match your taste - clickable to filter to only highlighted restaurants */}
          {highlightedCount > 0 && (
            <div
              className="legend-item"
              onClick={onHighlightedToggle}
              style={{
                cursor: 'pointer',
                fontWeight: highlightedActive ? 600 : 400
              }}
            >
              <div className="legend-marker" style={{ backgroundColor: '#FF69B4', width: '8px', height: '8px' }}></div>
              <span><span className="legend-count">{highlightedCount} </span>Fit your Vibe</span>
            </div>
          )}

          {/* Award winners - ALWAYS visible, clickable */}
          <div
            className="legend-item"
            onClick={onAwardsToggle}
            style={{
              cursor: 'pointer',
              fontWeight: awardsActive ? 600 : 400
            }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#FF9100', width: '5px', height: 'px' }}></div>
            <span><span className="legend-count">{awardWinnersCount === 0 ? '0' : awardWinnersCount} </span>Awarded</span>
          </div>

          {/* Favorites - ALWAYS visible, clickable */}
          <div
            className="legend-item"
            onClick={onFavoritesToggle}
            style={{
              cursor: 'pointer',
              fontWeight: favoritesActive ? 600 : 400
            }}
          >
            <div className="legend-marker" style={{ backgroundColor: '#c81224', width: '8px', height: '8px' }}></div>
            <span className="legend-favorites-text">
              <span className="legend-count">{favoritesCount === 0 ? '0' : favoritesCount} </span>favorited
            </span>
            <span className="legend-favorites-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#c81224" stroke="none" style={{ verticalAlign: 'middle' }}>
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
