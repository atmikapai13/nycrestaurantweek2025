import React, { useMemo } from 'react'
import { useMap } from '../contexts/MapContext'
import type { Restaurant } from '../types/restaurant'
import { asset } from '../utils/asset'
import './MapLegend.css'

const isMichelin = (r: Restaurant) =>
  Boolean(r.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS', 'BIB_GOURMAND'].includes(r.michelin_award))
const isNYT = (r: Restaurant) => Boolean(r.nyttop100_rank && r.nyttop100_rank !== '')

interface LegendRow {
  key: string
  label: string
  color: string
  icon?: string
  match: (r: Restaurant) => boolean
}

// Same precedence/colors as the map markers.
const ROWS: LegendRow[] = [
  { key: 'michelin', label: 'Michelin', color: '#c81224', icon: '/MichelinStar.svg.png', match: isMichelin },
  { key: 'nyt', label: 'NYT Top 100', color: '#ff67b2', icon: '/nytimes.png', match: isNYT },
  { key: 'offer26', label: '$26 Offer', color: '#16a34a', match: (r) => r.has_26_offer === true },
  { key: 'cup', label: 'Limited Edition Cup', color: '#2563eb', match: (r) => r.limited_edition_cup === true },
]

export const MapLegend: React.FC = () => {
  const { allRestaurants, filteredRestaurants, isochroneRegionSlugs, legendFilters, setLegendFilters } = useMap()

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const row of ROWS) c[row.key] = filteredRestaurants.filter(row.match).length
    c.regular = filteredRestaurants.filter(
      (r) => !isMichelin(r) && !isNYT(r) && !r.has_26_offer && !r.limited_edition_cup
    ).length
    return c
  }, [filteredRestaurants])

  const total = isochroneRegionSlugs ? isochroneRegionSlugs.length : allRestaurants.length

  const toggle = (key: string) =>
    setLegendFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  return (
    <div className="map-legend">
      <h4 className="map-legend-title">{total} Restaurants</h4>
      <div className="map-legend-subtitle">Click on list below:</div>
      <div className="map-legend-rows">
        {ROWS.filter((row) => counts[row.key] > 0).map((row) => (
          <button
            key={row.key}
            className={`map-legend-row ${legendFilters.includes(row.key) ? 'active' : ''}`}
            onClick={() => toggle(row.key)}
          >
            <span className="map-legend-dot" style={{ backgroundColor: row.color }} />
            {row.icon && <img src={asset(row.icon)} alt="" className="map-legend-icon" />}
            <span className="map-legend-label">{row.label}</span>
          </button>
        ))}
        {counts.regular > 0 && (
          <button
            className={`map-legend-row ${legendFilters.includes('regular') ? 'active' : ''}`}
            onClick={() => toggle('regular')}
          >
            <span className="map-legend-dot" style={{ backgroundColor: '#928f8e' }} />
            <span className="map-legend-label">The Rest</span>
          </button>
        )}
      </div>
    </div>
  )
}
