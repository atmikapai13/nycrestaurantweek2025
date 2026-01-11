import type { Restaurant } from '../types/restaurant'

interface MapLegendProps {
  // Counts
  allRestaurants: Restaurant[]
  isochroneRegionSlugs?: string[] | null
  highlightedIds?: Set<string>
  awardWinnersCount: number
  favoritesCount: number

  // Active states (all optional to match Map.tsx)
  highlightedActive?: boolean
  awardsActive?: boolean
  favoritesActive?: boolean
  hasVisibleIsochrones?: boolean

  // Callbacks (all optional to match Map.tsx)
  onHighlightedToggle?: () => void
  onAwardsToggle?: () => void
  onFavoritesToggle?: () => void
}

export const MapLegend: React.FC<MapLegendProps> = ({
  allRestaurants,
  isochroneRegionSlugs,
  highlightedIds,
  awardWinnersCount,
  favoritesCount,
  highlightedActive = false,
  awardsActive = false,
  favoritesActive = false,
  hasVisibleIsochrones = false,
  onHighlightedToggle,
  onAwardsToggle,
  onFavoritesToggle
}) => {
  return (
    <div className="map-legend">
      <div className="legend-content">
        <h4 style={{ color: '#000000', margin: '0 0 -4px 0' }}>
          Remi's pickings
        </h4>

        {/* Legend items */}
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-marker" style={{ backgroundColor: '#7c7c7c', width: '8px', height: '8px' }}></div>
            <span>
              {isochroneRegionSlugs && hasVisibleIsochrones
                ? `${isochroneRegionSlugs.length} in isochrone`
                : `${allRestaurants.length} restaurants`}
            </span>
          </div>

          {/* match your taste - clickable to filter to only highlighted restaurants */}
          {highlightedIds && highlightedIds.size > 0 && (
            <div
              className="legend-item"
              onClick={onHighlightedToggle}
              style={{
                cursor: 'pointer',
                fontWeight: highlightedActive ? 600 : 400
              }}
            >
              <div className="legend-marker" style={{ backgroundColor: '#FF69B4', width: '8px', height: '8px' }}></div>
              <span>{highlightedIds.size} match your taste</span>
            </div>
          )}

          {/* Award winners - clickable */}
          {awardWinnersCount > 0 && (
            <div
              className="legend-item"
              onClick={onAwardsToggle}
              style={{
                cursor: 'pointer',
                fontWeight: awardsActive ? 600 : 400
              }}
            >
              <div className="legend-marker" style={{ backgroundColor: '#FF9100', width: '8px', height: '8px' }}></div>
              <span>{awardWinnersCount} award-winners</span>
            </div>
          )}

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
            <span>{favoritesCount === 0 ? '0 favorited as of yet' : `${favoritesCount} favorited`}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
