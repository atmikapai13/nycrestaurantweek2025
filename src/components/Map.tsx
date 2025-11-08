import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Restaurant } from '../types/restaurant'
import ChatInterface from './ChatInterface'

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA"



interface MapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilters: string[]
  onLegendFilterChange: (filterType: string) => void
  totalRestaurants: number
  favorites: string[]
  onFilterChange: (filterType: string, values: string[]) => void
  allRestaurants: Restaurant[]
  onMapFocus?: (restaurantIds: string[]) => void
  selectedRestaurant?: Restaurant | null
}

export default function Map({ restaurants, onRestaurantSelect, activeFilters, onLegendFilterChange, favorites, onFilterChange, allRestaurants, onMapFocus, selectedRestaurant }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])
  const markerElements = useRef<HTMLDivElement[]>([])
  const currentZoom = useRef<number>(10.0)

  // Implement onMapFocus handler for semantic search results
  const handleMapFocus = (restaurantSlugs: string[]) => {
    console.log('Map focus requested for', restaurantSlugs.length, 'restaurants')

    // Filter allRestaurants to only include the semantic search results
    const focusedRestaurants = allRestaurants.filter(r => restaurantSlugs.includes(r.slug))

    if (focusedRestaurants.length === 0) {
      console.warn('No restaurants found matching the provided slugs')
      return
    }

    // Use onFilterChange to set a special "Semantic Search" filter
    // This will trigger App.tsx to update filteredRestaurants
    onFilterChange('Semantic Search Results', focusedRestaurants.map(r => r.slug))

    // Calculate bounds to fit all focused restaurants
    if (map.current && focusedRestaurants.length > 0) {
      const bounds = new mapboxgl.LngLatBounds()

      focusedRestaurants.forEach(restaurant => {
        if (restaurant.longitude && restaurant.latitude) {
          bounds.extend([restaurant.longitude, restaurant.latitude])
        }
      })

      // Fit map to bounds with padding
      map.current.fitBounds(bounds, {
        padding: { top: 100, bottom: 100, left: 100, right: 100 },
        maxZoom: 14
      })
    }
  }
  
  // Function to determine if device is mobile
  const isMobile = () => {
    return window.innerWidth <= 768 || 'ontouchstart' in window
  }
  
  // Function to calculate marker size based on zoom level and device
  const getMarkerSize = (baseSize: number, zoom: number, isMobileDevice: boolean) => {
    let size = baseSize
    
    // Increase size on mobile devices when zoomed in
    if (isMobile() && zoom >= 12) {
      size *= 1.5
    } else if (zoom >= 12) {
      size *= 1.4 }
    
    return Math.round(size)
  }
  
  // Function to update all marker sizes
  const updateMarkerSizes = () => {
    if (!map.current) return
    
    const zoom = map.current.getZoom()
    const mobile = isMobile()
    
    markerElements.current.forEach((markerEl, index) => {
      if (markerEl && markerEl.style) {
        // Get the base size from the marker's data attribute
        const baseSize = parseInt(markerEl.getAttribute('data-base-size') || '8')
        const newSize = getMarkerSize(baseSize, zoom, mobile)
        
        // Update the inner marker size (the visual marker)
        markerEl.style.width = `${newSize}px`
        markerEl.style.height = `${newSize}px`
        
        // Update the wrapper padding (the click area)
        const wrapper = markerEl.parentElement
        if (wrapper) {
          const padding = mobile ? '12px' : '8px'
          wrapper.style.padding = padding
        }
      }
    })
  }

  useEffect(() => {
    if (!mapContainer.current) return

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/atmikapai13/cmhdmnool00ai01qw6qz79zqu', // Custom style
      center: [-73.979545, 40.744293], // NYC coordinates
      zoom: 10.0
    })

    // Add zoom event listener to update marker sizes
    map.current.on('zoom', () => {
      updateMarkerSizes()
    })

    // Add resize event listener for mobile detection
    window.addEventListener('resize', updateMarkerSizes)

    return () => {
      if (map.current) {
        map.current.remove()
      }
      window.removeEventListener('resize', updateMarkerSizes)
    }
  }, [])

  // Update markers when restaurants change
  useEffect(() => {
    if (!map.current) return

    // Clear existing markers
    markers.current.forEach(marker => marker.remove())
    markers.current = []
    markerElements.current = []

    // Apply legend filter to the already filtered restaurants from App component
    const legendFilteredRestaurants = restaurants.filter(restaurant => {
      if (activeFilters.length === 0) return true // Show all if no filter active
      
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

    // Add new markers for restaurants with coordinates
    legendFilteredRestaurants.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // Determine marker color based on Michelin award (priority) or NYT Top 100
        let markerColor = '#000000' // Black for NYC Restaurant Week restaurants
        let markerSize = '8px'
        
        if (restaurant.michelin_award) {
          if (['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(restaurant.michelin_award)) {
            markerColor = ' #C81224' // Red for Michelin starred restaurants
            markerSize = '10px'
          } else if (restaurant.michelin_award === 'BIB_GOURMAND') {
            markerColor = '#f9a83d' // Orange for Bib Gourmand
            markerSize = '10px'
          }
        } else if (restaurant.nyttop100_rank) {
          markerColor = '#FF69B4' // Hot pink for NYT Top 100 restaurants
          markerSize = '10px'
        }
        
        // Create marker wrapper for larger click area
        const markerWrapper = document.createElement('div')
        markerWrapper.style.padding = isMobile() ? '12px' : '8px' // Larger padding on mobile
        markerWrapper.style.display = 'flex'
        markerWrapper.style.alignItems = 'center'
        markerWrapper.style.justifyContent = 'center'
        markerWrapper.style.cursor = 'pointer'
        
        // Create the actual marker element (smaller, inside the wrapper)
        const markerEl = document.createElement('div')
        markerEl.className = 'restaurant-marker'
        markerEl.style.width = markerSize
        markerEl.style.height = markerSize
        markerEl.style.borderRadius = '50%'
        markerEl.style.backgroundColor = markerColor
        markerEl.style.border = '1px solid white'
        markerEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'
        
        // Add the marker to the wrapper
        markerWrapper.appendChild(markerEl)
        
        // Store base size for dynamic resizing
        const baseSize = parseInt(markerSize)
        markerEl.setAttribute('data-base-size', baseSize.toString())

        // Create marker using the wrapper
        const marker = new mapboxgl.Marker(markerWrapper)
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .addTo(map.current!)

        // Add click handler to the wrapper
        markerWrapper.addEventListener('click', () => {
          onRestaurantSelect(restaurant)
        })

        markers.current.push(marker)
        markerElements.current.push(markerEl) // Still track the inner marker for size updates
      }
    })
    
    // Update marker sizes after creating all markers
    updateMarkerSizes()
  }, [restaurants, onRestaurantSelect, activeFilters])

  const handleLegendClick = (filterType: string) => {
    onLegendFilterChange(filterType)
  }

  // Calculate the count of restaurants that match the current legend filter
  const legendFilteredRestaurants = restaurants.filter(restaurant => {
    if (activeFilters.length === 0) return true // Show all if no filter active
    
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {/* Chat/Remy Interface (now inside map, overlays map region only) */}
      <ChatInterface
        restaurants={restaurants}
        allRestaurants={allRestaurants}
        onFilterChange={onFilterChange}
        onRestaurantSelect={onRestaurantSelect}
        onMapFocus={handleMapFocus}
        selectedRestaurant={selectedRestaurant}
      />
      {/* Map Legend */}
      <div className="map-legend">
        <h4 style={{ color: '#000000', margin: '0' }}>{legendFilteredRestaurants.length} Restaurants</h4>
      </div>
    </div>
  )
} 