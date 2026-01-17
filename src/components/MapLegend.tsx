import React, { useMemo } from 'react'
import { useMap, hasAnyAward } from '../contexts/MapContext'

export const MapLegend: React.FC = () => {
  const {
    allRestaurants,
    filteredRestaurants,
    isochroneRegionSlugs,
    awardsActive,
    setAwardsActive,
    favorites,
    favoritesActive,
    setFavoritesActive
  } = useMap()

  const awardWinnersCount = useMemo(() => {
    return filteredRestaurants.filter((r) => hasAnyAward(r)).length
  }, [filteredRestaurants])

  const favoritesCount = useMemo(() => {
    return filteredRestaurants.filter((r) => favorites.includes(r.name)).length
  }, [filteredRestaurants, favorites])

  const hasVisibleIsochrones = isochroneRegionSlugs !== null

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

          {/* Award winners - clickable */}
          {awardWinnersCount > 0 && (
            <div
              className="legend-item"
              onClick={() => setAwardsActive(!awardsActive)}
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
            onClick={() => setFavoritesActive(!favoritesActive)}
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
