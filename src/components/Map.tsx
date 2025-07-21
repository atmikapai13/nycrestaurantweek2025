import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Restaurant } from '../types/restaurant'

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA"

interface MapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilter: string | null
  onLegendFilterChange: (filterType: string | null) => void
  totalRestaurants: number
}

export default function Map({ restaurants, onRestaurantSelect, activeFilter, onLegendFilterChange, totalRestaurants }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    if (!mapContainer.current) return

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12', // Light style like your prototype
      center: [-74.006, 40.7128], // NYC coordinates
      zoom: 10.0
    })

    return () => {
      if (map.current) {
        map.current.remove()
      }
    }
  }, [])

  // Update markers when restaurants change
  useEffect(() => {
    if (!map.current) return

    // Clear existing markers
    markers.current.forEach(marker => marker.remove())
    markers.current = []

    // Apply legend filter to the already filtered restaurants from App component
    const legendFilteredRestaurants = restaurants.filter(restaurant => {
      if (!activeFilter) return true // Show all if no filter active
      
      if (activeFilter === 'michelin') {
        return restaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)
      } else if (activeFilter === 'bib') {
        return restaurant.michelin_award === 'BIB_GOURMAND'
      } else if (activeFilter === 'regular') {
        return !restaurant.michelin_award
      }
      return true
    })

    // Add new markers for restaurants with coordinates
    legendFilteredRestaurants.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // Determine marker color based on Michelin award
        let markerColor = '#000000' // Black for NYC Restaurant Week restaurants
        let markerSize = '8px'
        
        if (restaurant.michelin_award) {
          if (['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)) {
            markerColor = '#8B5CF6' // Purple for Michelin starred restaurants
            markerSize = '10px'
          } else if (restaurant.michelin_award === 'BIB_GOURMAND') {
            markerColor = '#3B82F6' // Blue for Bib Gourmand
            markerSize = '10px'
          }
        }
        
        // Create marker element
        const markerEl = document.createElement('div')
        markerEl.className = 'restaurant-marker'
        markerEl.style.width = markerSize
        markerEl.style.height = markerSize
        markerEl.style.borderRadius = '50%'
        markerEl.style.backgroundColor = markerColor
        markerEl.style.border = '1px solid white'
        markerEl.style.cursor = 'pointer'
        markerEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'

        // Create popup
        const popup = new mapboxgl.Popup({
          offset: 25,
          closeButton: false,
          className: 'restaurant-popup'
        }).setHTML(`
          <div class="popup-content">
            <h3 class="popup-title">${restaurant.name}</h3>
            <p class="popup-borough">${restaurant.borough}</p>
            <p class="popup-cuisine">${restaurant.cuisine}</p>
          </div>
        `)

        // Create marker
        const marker = new mapboxgl.Marker(markerEl)
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .setPopup(popup)
          .addTo(map.current!)

        // Add click handler
        markerEl.addEventListener('click', () => {
          onRestaurantSelect(restaurant)
        })

        markers.current.push(marker)
      }
    })
  }, [restaurants, onRestaurantSelect, activeFilter])

  const handleLegendClick = (filterType: string) => {
    if (activeFilter === filterType) {
      // If clicking the same filter, deactivate it
      onLegendFilterChange(null)
    } else {
      // Otherwise, set the new filter
      onLegendFilterChange(filterType)
    }
  }

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      
      {/* Map Legend */}
      <div className="map-legend">
        <h4 style={{ color: '#000000' }}>{totalRestaurants} NYC Restaurants</h4>
        <div 
          className="legend-item" 
          onClick={() => handleLegendClick('michelin')}
          style={{ cursor: 'pointer' }}
        >
          <div className="legend-marker" style={{ backgroundColor: '#8B5CF6', width: '10px', height: '10px' }}></div>
          <span style={{ fontWeight: activeFilter === 'michelin' ? 'bold' : 'normal', fontStyle: activeFilter === 'michelin' ? 'italic' : 'normal', color: '#000000' }}>Michelin</span>
        </div>
        <div 
          className="legend-item" 
          onClick={() => handleLegendClick('bib')}
          style={{ cursor: 'pointer' }}
        >
          <div className="legend-marker" style={{ backgroundColor: '#3B82F6', width: '9px', height: '9px' }}></div>
          <span style={{ fontWeight: activeFilter === 'bib' ? 'bold' : 'normal', fontStyle: activeFilter === 'bib' ? 'italic' : 'normal', color: '#000000' }}>Bib Gourmand</span>
        </div>
        <div 
          className="legend-item" 
          onClick={() => handleLegendClick('regular')}
          style={{ cursor: 'pointer' }}
        >
          <div className="legend-marker" style={{ backgroundColor: '#000000', width: '8px', height: '8px' }}></div>
          <span style={{ fontWeight: activeFilter === 'regular' ? 'bold' : 'normal', fontStyle: activeFilter === 'regular' ? 'italic' : 'normal', color: '#000000' }}>The Rest</span>
        </div>
      </div>
    </div>
  )
} 