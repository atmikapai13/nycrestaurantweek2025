import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Restaurant } from '../types/restaurant'
import ChatInterface from './ChatInterface'

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA"

// IsochroneLayer interface for multi-polygon visualization
export interface IsochroneLayer {
  id: string                          // 'person1', 'person2', 'intersection', 'union'
  polygon: GeoJSON.Feature            // The actual geometry
  label: string                       // 'Alice', 'Bob', 'Overlap', etc.
  color: string                       // Fill color (hex)
  strokeColor: string                 // Outline color (hex)
  opacity: number                     // 0-1 for fill opacity
  metadata?: {
    location?: string                 // Original query location
    travel_time?: number              // Minutes
    mode?: string                     // 'walking', 'transit', etc.
    isDashed?: boolean                // For dashed outline (exclusion visualization)
  }
}



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
  onIsochroneLayersUpdate?: (layers: IsochroneLayer[]) => void
  onResetAll?: () => void
  mapResetRef?: React.MutableRefObject<(() => void) | null>
  highlightedIds?: Set<string>
  onIsochroneRegion?: (slugs: string[] | null) => void
  isochroneRegionSlugs?: string[] | null
}

export default function Map({ restaurants, onRestaurantSelect, activeFilters, onLegendFilterChange, favorites, onFilterChange, allRestaurants, onMapFocus, selectedRestaurant, onIsochroneLayersUpdate, onResetAll, mapResetRef, highlightedIds, onIsochroneRegion, isochroneRegionSlugs }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])
  const markerElements = useRef<HTMLDivElement[]>([])
  const currentZoom = useRef<number>(10.0)

  // Backward compatible: keep single polygon state for existing isochrone queries
  const [isochronePolygon, setIsochronePolygon] = useState<any>(null)

  // New: multi-layer state for Phase 3 spatial operations
  const [isochroneLayers, setIsochroneLayers] = useState<IsochroneLayer[]>([])

  // Function to reset map state (isochrones and view)
  const resetMapView = () => {
    // Clear isochrone polygons
    setIsochronePolygon(null)
    setIsochroneLayers([])

    // Reset map to default NYC view
    if (map.current) {
      map.current.flyTo({
        center: [-73.979545, 40.744293], // NYC coordinates
        zoom: 10.0,
        duration: 1000
      })
    }
  }

  // Set the reset function to the ref so App.tsx can call it
  useEffect(() => {
    if (mapResetRef) {
      mapResetRef.current = resetMapView
    }
  }, [mapResetRef])

  // Implement onMapFocus handler for semantic search results
  const handleMapFocus = (restaurantSlugs: string[]) => {
    console.log('Map focus requested for', restaurantSlugs.length, 'restaurants')

    // Filter allRestaurants to only include the semantic search results
    const focusedRestaurants = allRestaurants.filter(r => restaurantSlugs.includes(r.slug))

    if (focusedRestaurants.length === 0) {
      console.warn('No restaurants found matching the provided slugs')
      return
    }

    // DON'T set isochrone region here - that should only be set by actual isochrone queries
    // This function is called by RAG/semantic/filter results, which should highlight within existing isochrone

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
          const padding = mobile ? '10px' : '8px'
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

    // Load custom pattern and configure map style
    map.current.on('load', () => {
      const img = new Image(20, 20)
      img.onload = () => {
        if (map.current) {
          map.current.addImage('red-dots-pattern', img)
        }
      }
      img.src = '/patterns/red-dots.svg'

      // Hide highway shields/signs for cleaner map
      const style = map.current?.getStyle()
      if (style && style.layers) {
        // Log all layer IDs to debug
        console.log('Map layers:', style.layers.map((l: any) => l.id))

        style.layers.forEach((layer: any) => {
          // Only hide layers with "shield" in the name (highway numbers)
          // This preserves street names while removing route shields
          if (layer.id.includes('shield') ||
              layer.id.includes('road-number') ||
              (layer.type === 'symbol' && layer.id.includes('motorway') && layer.id.includes('label'))) {
            console.log('Hiding layer:', layer.id)
            map.current?.setLayoutProperty(layer.id, 'visibility', 'none')
          }
        })
      }
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

  // Handle isochrone polygon visualization
  useEffect(() => {
    if (!map.current) return

    const sourceId = 'isochrone-polygon'
    const fillLayerId = 'isochrone-fill'
    const outlineLayerId = 'isochrone-outline'

    // Wait for map to load before adding layers
    const updatePolygon = () => {
      const mapInstance = map.current!

      // Remove existing layers and source if they exist
      if (mapInstance.getLayer(fillLayerId)) {
        mapInstance.removeLayer(fillLayerId)
      }
      if (mapInstance.getLayer(outlineLayerId)) {
        mapInstance.removeLayer(outlineLayerId)
      }
      if (mapInstance.getSource(sourceId)) {
        mapInstance.removeSource(sourceId)
      }

      // Add new polygon if provided
      if (isochronePolygon) {
        // Add GeoJSON source
        mapInstance.addSource(sourceId, {
          type: 'geojson',
          data: isochronePolygon
        })

        // Add fill layer (pink with transparency)
        mapInstance.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': '#FF69B4', // Hot pink
            'fill-opacity': 0.2
          }
        })

        // Add outline layer
        mapInstance.addLayer({
          id: outlineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#FF1493', // Deep pink
            'line-width': 2,
            'line-opacity': 0.4
          }
        })

        // Fit map to polygon bounds
        const bounds = new mapboxgl.LngLatBounds()

        try {
          const geometry = isochronePolygon.geometry || isochronePolygon

          if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
            geometry.coordinates[0].forEach((coord: [number, number]) => {
              bounds.extend(coord)
            })
          } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
            // Handle MultiPolygon (Geoapify sometimes returns this)
            geometry.coordinates.forEach((polygon: any) => {
              if (polygon[0]) {
                polygon[0].forEach((coord: [number, number]) => {
                  bounds.extend(coord)
                })
              }
            })
          } else {
            console.warn('Unknown polygon geometry type:', geometry.type)
          }

          // Only fitBounds if we actually added coordinates
          if (!bounds.isEmpty()) {
            mapInstance.fitBounds(bounds, {
              padding: { top: 100, bottom: 100, left: 100, right: 100 },
              maxZoom: 14
            })
          }
        } catch (error) {
          console.error('Error fitting bounds to isochrone polygon:', error)
          console.log('Polygon data:', isochronePolygon)
        }
      }
    }

    if (map.current.isStyleLoaded()) {
      updatePolygon()
    } else {
      map.current.once('load', updatePolygon)
    }
  }, [isochronePolygon])

  // Handle multi-layer isochrone visualization (Phase 3)
  useEffect(() => {
    if (!map.current) return

    const mapInstance = map.current

    // Wait for map to load before adding layers
    const updateLayers = () => {
      // Remove ONLY multi-layer isochrone layers (not the single isochrone layers)
      // Single isochrone uses: 'isochrone-fill' and 'isochrone-outline'
      // Multi-layer uses: 'isochrone-fill-<id>' and 'isochrone-outline-<id>'
      const existingLayers = mapInstance.getStyle().layers.filter((l: any) =>
        l.id.startsWith('isochrone-') && (l.id.includes('-person') || l.id.includes('-exclusion') || l.id.includes('-intersection') || l.id.includes('-union'))
      )
      existingLayers.forEach((layer: any) => {
        if (mapInstance.getLayer(layer.id)) {
          mapInstance.removeLayer(layer.id)
        }
      })

      // Remove ONLY multi-layer isochrone sources (not the single isochrone source)
      const existingSources = Object.keys(mapInstance.getStyle().sources || {}).filter((s: string) =>
        s.startsWith('isochrone-') && (s.includes('-person') || s.includes('-exclusion') || s.includes('-intersection') || s.includes('-union'))
      )
      existingSources.forEach((source: string) => {
        if (mapInstance.getSource(source)) {
          mapInstance.removeSource(source)
        }
      })

      // If no layers to add (empty array), just return after cleanup
      if (isochroneLayers.length === 0) return

      // Separate base layers (person1, person2, etc.) from result layers (intersection, union)
      const baseLayers = isochroneLayers.filter(l => l.id.startsWith('person'))
      const resultLayers = isochroneLayers.filter(l => !l.id.startsWith('person'))

      // Add layers in order: base layers first, then result layers (so result is on top)
      const layersToAdd = [...baseLayers, ...resultLayers]

      layersToAdd.forEach((layer) => {
        const sourceId = `isochrone-${layer.id}`
        const fillLayerId = `isochrone-fill-${layer.id}`
        const outlineLayerId = `isochrone-outline-${layer.id}`

        // Add GeoJSON source
        mapInstance.addSource(sourceId, {
          type: 'geojson',
          data: layer.polygon
        })

        // Check if this is an excluded area (uses pattern instead of solid fill)
        const isExcluded = layer.metadata?.isDashed || false

        if (isExcluded) {
          // Excluded area - use red dot pattern fill, no outline
          mapInstance.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-pattern': 'red-dots-pattern'
            }
          })
        } else {
          // Normal area - solid color fill with opacity
          if (layer.opacity > 0) {
            mapInstance.addLayer({
              id: fillLayerId,
              type: 'fill',
              source: sourceId,
              paint: {
                'fill-color': layer.color,
                'fill-opacity': layer.opacity
              }
            })
          }

          // Add outline for normal (non-excluded) layers
          mapInstance.addLayer({
            id: outlineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': layer.strokeColor,
              'line-width': 2,
              'line-opacity': 0.4
            }
          })
        }
      })

      // Fit map bounds to ALL polygons
      if (isochroneLayers.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()

        isochroneLayers.forEach((layer) => {
          try {
            const geometry = layer.polygon.geometry || layer.polygon

            if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
              geometry.coordinates[0].forEach((coord: [number, number]) => {
                bounds.extend(coord)
              })
            } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
              geometry.coordinates.forEach((polygon: any) => {
                if (polygon[0]) {
                  polygon[0].forEach((coord: [number, number]) => {
                    bounds.extend(coord)
                  })
                }
              })
            }
          } catch (error) {
            console.error('Error processing layer geometry:', layer.id, error)
          }
        })

        if (!bounds.isEmpty()) {
          mapInstance.fitBounds(bounds, {
            padding: { top: 100, bottom: 100, left: 100, right: 100 },
            maxZoom: 14
          })
        }
      }
    }

    if (mapInstance.isStyleLoaded()) {
      updateLayers()
    } else {
      mapInstance.once('load', updateLayers)
    }
  }, [isochroneLayers])

  // Update markers when restaurants change
  useEffect(() => {
    if (!map.current) return

    // Clear existing markers
    markers.current.forEach(marker => marker.remove())
    markers.current = []
    markerElements.current = []

    // Render ALL restaurants with coordinates
    allRestaurants.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // SIMPLE COLOR LOGIC: Pink if highlighted, black otherwise
        const isHighlighted = highlightedIds?.has(restaurant.slug)
        const markerColor = isHighlighted ? '#FF69B4' : '#7c7c7c'
        const markerSize = isHighlighted ? '10px' : '8px'  // Pink markers larger

        // Create marker wrapper for larger click area
        const markerWrapper = document.createElement('div')
        markerWrapper.style.padding = isMobile() ? '10px' : '8px'
        markerWrapper.style.display = 'flex'
        markerWrapper.style.alignItems = 'center'
        markerWrapper.style.justifyContent = 'center'
        markerWrapper.style.cursor = 'pointer'

        // Create the actual marker element
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
        markerElements.current.push(markerEl)
      }
    })

    // Update marker sizes after creating all markers
    updateMarkerSizes()
  }, [allRestaurants, highlightedIds, onRestaurantSelect])

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
        onIsochroneUpdate={setIsochronePolygon}
        onIsochroneLayersUpdate={setIsochroneLayers}
        onResetAll={onResetAll}
        isochroneRegionSlugs={isochroneRegionSlugs}
        onIsochroneRegion={onIsochroneRegion}
      />
      {/* Map Legend */}
      <div className="map-legend">
        <h4 style={{ color: '#000000', margin: '0' }}>
          {highlightedIds && highlightedIds.size > 0
            ? `${highlightedIds.size} matching / ${allRestaurants.length} total`
            : `${allRestaurants.length} Restaurants`}
        </h4>
      </div>
    </div>
  )
} 