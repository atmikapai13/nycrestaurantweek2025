import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Restaurant } from '../types/restaurant'

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA"

interface MapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
}

export default function Map({ restaurants, onRestaurantSelect }: MapProps) {
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
      zoom: 10
    })

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

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

    // Add new markers for restaurants with coordinates
    restaurants.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // Create marker element
        const markerEl = document.createElement('div')
        markerEl.className = 'restaurant-marker'
        markerEl.style.width = '8px'
        markerEl.style.height = '8px'
        markerEl.style.borderRadius = '50%'
        markerEl.style.backgroundColor = '#FF4B33'
        markerEl.style.border = '1px solid white'
        markerEl.style.width = '8px'
        markerEl.style.height = '8px'
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
            <p class="popup-cuisine">${restaurant.cuisine.join(', ')}</p>
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
  }, [restaurants, onRestaurantSelect])

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
    </div>
  )
} 