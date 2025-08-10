import { useEffect, useRef, useState } from 'react'
import type { Restaurant } from '../types/restaurant'

interface OSMMapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilters: string[]
  onLegendFilterChange: (filterType: string) => void
  totalRestaurants: number
  favorites: string[]
  isOffline?: boolean
}

export default function OSMMap({ 
  restaurants, 
  onRestaurantSelect, 
  activeFilters, 
  onLegendFilterChange, 
  totalRestaurants, 
  favorites,
  isOffline = false 
}: OSMMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  useEffect(() => {
    if (!mapContainer.current) return

    // Initialize OSM map using Leaflet
    const L = (window as any).L
    if (!L) {
      console.error('Leaflet not loaded')
      return
    }

    // Create map centered on NYC
    const map = L.map(mapContainer.current).setView([40.7128, -74.0060], 11)

    // Add OSM tile layer
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map)

    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
      }
    }
  }, [])

  // Update markers when restaurants change
  useEffect(() => {
    if (!mapRef.current) return

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    // Add new markers
    restaurants.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        const L = (window as any).L
        if (!L) return

        // Determine marker color based on filters
        let markerColor = '#666666' // Default gray
        let markerSize = 'medium'

        if (favorites.includes(restaurant.name)) {
          markerColor = '#FF69B4' // Pink for favorites
          markerSize = 'large'
        } else if (restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)) {
          markerColor = '#FFD700' // Gold for Michelin stars
        } else if (restaurant.michelin_award === 'BIB_GOURMAND') {
          markerColor = '#FF6B35' // Orange for Bib Gourmand
        } else if (restaurant.nyttop100_rank) {
          markerColor = '#000000' // Black for NYT Top 100
        }

        // Create custom marker icon
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="
            width: ${markerSize === 'large' ? '16px' : '12px'};
            height: ${markerSize === 'large' ? '16px' : '12px'};
            background-color: ${markerColor};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [markerSize === 'large' ? 16 : 12, markerSize === 'large' ? 16 : 12],
          iconAnchor: [markerSize === 'large' ? 8 : 6, markerSize === 'large' ? 8 : 6]
        })

        const marker = L.marker([restaurant.latitude, restaurant.longitude], { icon })
          .addTo(mapRef.current)
          .bindPopup(`
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
              <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">${restaurant.name}</h3>
              <p style="margin: 0 0 4px 0; color: #666; font-size: 14px;">${restaurant.cuisine}</p>
              <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">${restaurant.borough}</p>
              <button onclick="window.selectRestaurant('${restaurant.name}')" style="
                background: #FF69B4;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
              ">View Details</button>
            </div>
          `)

        marker.on('click', () => {
          onRestaurantSelect(restaurant)
        })

        markersRef.current.push(marker)
      }
    })
  }, [restaurants, favorites, onRestaurantSelect])

  // Add global function for popup buttons
  useEffect(() => {
    (window as any).selectRestaurant = (name: string) => {
      const restaurant = restaurants.find(r => r.name === name)
      if (restaurant) {
        onRestaurantSelect(restaurant)
      }
    }

    return () => {
      delete (window as any).selectRestaurant
    }
  }, [restaurants, onRestaurantSelect])

  return (
    <div className="osm-map-container">
      {isOffline && (
        <div className="offline-indicator">
          <span>📱 Offline Mode - Using OpenStreetMap</span>
        </div>
      )}
      <div ref={mapContainer} className="osm-map" style={{ height: '100%', width: '100%' }} />
      
      {/* Legend */}
      <div className="map-legend">
        <h4>Restaurant Types</h4>
        <div className="legend-item" onClick={() => onLegendFilterChange('michelin')}>
          <div className="legend-marker" style={{ backgroundColor: '#FFD700' }}></div>
          Michelin Starred
        </div>
        <div className="legend-item" onClick={() => onLegendFilterChange('bib')}>
          <div className="legend-marker" style={{ backgroundColor: '#FF6B35' }}></div>
          Bib Gourmand
        </div>
        <div className="legend-item" onClick={() => onLegendFilterChange('nyt')}>
          <div className="legend-marker" style={{ backgroundColor: '#000000' }}></div>
          NYT Top 100
        </div>
        <div className="legend-item" onClick={() => onLegendFilterChange('regular')}>
          <div className="legend-marker" style={{ backgroundColor: '#666666' }}></div>
          Regular
        </div>
        <div className="legend-item">
          <div className="legend-marker" style={{ backgroundColor: '#FF69B4' }}></div>
          Favorites
        </div>
      </div>
    </div>
  )
}
