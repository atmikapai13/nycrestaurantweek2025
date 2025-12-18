import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Restaurant } from '../types/restaurant'
import ChatInterface, { type ChatInterfaceHandle } from './ChatInterface'

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
  onToggleFavorite?: (restaurantName: string) => void
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
  favoritesActive?: boolean
  onFavoritesToggle?: () => void
}

export default function Map({ restaurants, onRestaurantSelect, favorites, onToggleFavorite, onFilterChange, allRestaurants, onMapFocus: _onMapFocus, selectedRestaurant, onIsochroneLayersUpdate: _onIsochroneLayersUpdate, onResetAll, mapResetRef, highlightedIds, onIsochroneRegion, isochroneRegionSlugs, favoritesActive, onFavoritesToggle }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])
  const markerElements = useRef<HTMLDivElement[]>([])
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null)

  // Backward compatible: keep single polygon state for existing isochrone queries
  const [isochronePolygon, setIsochronePolygon] = useState<any>(null)

  // New: multi-layer state for Phase 3 spatial operations
  const [isochroneLayers, setIsochroneLayers] = useState<IsochroneLayer[]>([])

  // Track selected restaurant for purple marker indicator
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState<string | null>(null)

  // Function to reset map state (isochrones and view)
  const resetMapView = () => {
    // Clear isochrone polygons
    setIsochronePolygon(null)
    setIsochroneLayers([])

    // Clear selected restaurant
    setSelectedRestaurantSlug(null)
    console.log('🟣 Cleared selected restaurant')

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768

    const center = isMobile ? [-73.998, 40.715] : [-74.014, 40.737]
    const zoom = isMobile ? 11.8 : 12.58

    console.log('🔄 Resetting map view:', { isMobile, center, zoom })

    // Reset map to default view (mobile or desktop)
    if (map.current) {
      map.current.flyTo({
        center: center as [number, number],
        zoom,
        pitch: 45,
        bearing: 0,
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

      // Fit map to bounds with responsive padding
      const isMobileView = window.innerWidth <= 768
      map.current.fitBounds(bounds, {
        padding: isMobileView
          ? { top: 80, bottom: 280, left: 20, right: 20 }  // Mobile: pad bottom for drawer
          : { top: 100, bottom: 100, left: 200, right: 100 }, // Desktop: pad left for chat panel
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

    // Increase size in mobile when zoomed in
    if (isMobileDevice && zoom >= 12.5) {
      size *= 1.6
    } else if (zoom >= 12.0) {
      size *= 1.4
    }
    // Increase size in desktop when zoomed in
    if (!isMobileDevice && zoom >= 14.0) {
      size *= 1.3
    } else if (zoom >= 12.0) {
      size *= 0.9
    }

    return Math.round(size)
  }

  // Function to update all marker sizes
  const updateMarkerSizes = () => {
    if (!map.current) return

    const zoom = map.current.getZoom()
    const mobile = isMobile()

    markerElements.current.forEach((markerEl) => {
      if (markerEl && markerEl.style) {
        // Get the base size from the marker's data attribute
        const baseSize = parseInt(markerEl.getAttribute('data-base-size') || '6')
        const newSize = getMarkerSize(baseSize, zoom, mobile)

        // Update the inner marker size (the visual marker)
        markerEl.style.width = `${newSize}px`
        markerEl.style.height = `${newSize}px`

        // Update the wrapper padding (the click area)
        const wrapper = markerEl.parentElement
        if (wrapper) {
          const padding = mobile ? '8px' : '6px'
          wrapper.style.padding = padding
        }
      }
    })
  }

  useEffect(() => {
    if (!mapContainer.current) return

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768

    // Mobile-specific viewport: shifted south to account for 40% drawer at bottom
    const mobileCenter: [number, number] = [-73.998, 40.705] // Shifted south to show lower Manhattan
    const mobileZoom = 11.5
    const mobilePitch = 45
    const mobileBearing = 0

    // Desktop viewport
    const desktopCenter: [number, number] = [-74.014, 40.737]
    const desktopZoom = 12.58
    const desktopPitch = 45
    const desktopBearing = 0

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/atmikapai13/cmhdmnool00ai01qw6qz79zqu', // Custom style
      center: isMobile ? mobileCenter : desktopCenter,
      zoom: isMobile ? mobileZoom : desktopZoom,
      pitch: isMobile ? mobilePitch : desktopPitch,
      bearing: isMobile ? mobileBearing : desktopBearing,
      customAttribution: '© <a href="https://atmikapai.dev/" target="_blank">Atmika Pai</a> © <a href="https://marauders.earth/" target="_blank">Marauders.Earth</a> © <a href="https://www.fultonring.com/" target="_blank">Fulton Ring</a>'
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
            const isMobileView = window.innerWidth <= 768
            mapInstance.fitBounds(bounds, {
              padding: isMobileView
                ? { top: 80, bottom: 280, left: 20, right: 20 }  // Mobile: pad bottom for drawer (35vh ≈ 280px)
                : { top: 100, bottom: 100, left: 700, right: 100 }, // Desktop: pad left for chat panel
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

        // Add fill layer with solid color
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

        // Add outline layer
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
      })

      // Fit map bounds to ALL polygons
      if (isochroneLayers.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()

        isochroneLayers.forEach((layer) => {
          try {
            const geometry = layer.polygon.geometry || layer.polygon

            if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
              geometry.coordinates[0].forEach((coord: any) => {
                bounds.extend(coord as [number, number])
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

        // Fit bounds with responsive padding
        if (!bounds.isEmpty()) {
          const isMobileView = window.innerWidth <= 768
          mapInstance.fitBounds(bounds, {
            padding: isMobileView
              ? { top: 80, bottom: 280, left: 20, right: 20 }  // Mobile: pad bottom for drawer (35vh ≈ 280px)
              : { top: 100, bottom: 100, left: 700, right: 100 }, // Desktop: pad left for chat panel
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

    // Determine which restaurants to render based on mode
    let restaurantsToRender: Restaurant[];

    if (favoritesActive && highlightedIds && highlightedIds.size > 0) {
      // Favorites mode: show ALL favorited restaurants (ignore isochrone filtering)
      restaurantsToRender = allRestaurants.filter(r => highlightedIds.has(r.slug));
    } else if (isochroneRegionSlugs) {
      // Isochrone active: only show restaurants within isochrone boundary
      restaurantsToRender = allRestaurants.filter(r => isochroneRegionSlugs.includes(r.slug));
    } else {
      // Default: show all restaurants
      restaurantsToRender = allRestaurants;
    }

    console.log('🗺️ Map rendering:', {
      totalRestaurants: allRestaurants.length,
      isochroneActive: !!isochroneRegionSlugs,
      isochroneRegionSlugs: isochroneRegionSlugs,
      isochroneCount: isochroneRegionSlugs?.length || 0,
      favoritesActive: favoritesActive,
      restaurantsToRender: restaurantsToRender.length,
      filtering: isochroneRegionSlugs ? 'FILTERING ENABLED' : favoritesActive ? 'FAVORITES ONLY' : 'SHOWING ALL RESTAURANTS'
    });

    // Render restaurants with coordinates
    restaurantsToRender.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // 4-TIER COLOR LOGIC: Purple (selected), Red (favorites mode), Pink (highlighted), Grey (rest)
        const isHighlighted = highlightedIds?.has(restaurant.slug)
        const isSelected = selectedRestaurantSlug === restaurant.slug
        const isFavoriteMode = favoritesActive && isHighlighted

        let markerColor = '#7c7c7c'  // Default grey
        let markerSize = '6px'       // Normal size
        let zIndex = 1

        if (isSelected) {
          // Selected restaurant: purple marker, same size as pink/red
          markerColor = '#8b4dfe'    // Purple
          markerSize = '10px'
          zIndex = 3                 // Highest layer (above pink/red)
        } else if (isFavoriteMode) {
          // Favorite mode active: red markers for favorites
          markerColor = '#c81224'    // Red for favorites
          markerSize = '10px'
          zIndex = 2                 // Same layer as pink
        } else if (isHighlighted) {
          markerColor = '#FF69B4'    // Pink for matches
          markerSize = '10px'        // Slightly bigger
          zIndex = 2                 // Higher layer (in front of grey)
        }

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
        markerEl.style.zIndex = zIndex.toString()

        // Add the marker to the wrapper
        markerWrapper.appendChild(markerEl)

        // Store base size for dynamic resizing
        const baseSize = parseInt(markerSize)
        markerEl.setAttribute('data-base-size', baseSize.toString())

        // Create marker using the wrapper
        const marker = new mapboxgl.Marker(markerWrapper)
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .addTo(map.current!)

        // Add click handler to the wrapper - show restaurant card in chat
        markerWrapper.addEventListener('click', () => {
          // If clicking already-selected restaurant, deselect it
          if (selectedRestaurantSlug === restaurant.slug) {
            console.log(`🟣 Deselecting restaurant: ${restaurant.name}`)
            setSelectedRestaurantSlug(null)  // Clear selection
            return
          }

          // Update selection state (triggers marker re-render)
          setSelectedRestaurantSlug(restaurant.slug)
          console.log(`🟣 Selected restaurant: ${restaurant.name}`)

          // Add restaurant card to chat
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.addRestaurantCard(restaurant)
          }
        })

        markers.current.push(marker)
        markerElements.current.push(markerEl)
      }
    })

    // Update marker sizes after creating all markers
    updateMarkerSizes()
  }, [allRestaurants, highlightedIds, onRestaurantSelect, isochroneRegionSlugs, selectedRestaurantSlug, favoritesActive])



  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {/* Chat Interface (overlays map region) */}
      <ChatInterface
        ref={chatInterfaceRef}
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
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        favoritesActive={favoritesActive}
        onFavoritesToggle={onFavoritesToggle}
      />
      {/* Map Legend */}
      <div className="map-legend">
        <h4 style={{ color: '#000000', margin: '0' }}>
          Remi's picks
        </h4>
        {/* Legend items */}
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-marker" style={{ backgroundColor: '#7c7c7c', width: '6px', height: '6px' }}></div>
            <span>
              {isochroneRegionSlugs
                ? `${isochroneRegionSlugs.length} in isochrone`
                : `${allRestaurants.length} restaurants`}
            </span>
          </div>
          {favoritesActive && highlightedIds && highlightedIds.size > 0 ? (
            <div className="legend-item">
              <div className="legend-marker" style={{ backgroundColor: '#c81224', width: '10px', height: '10px' }}></div>
              <span>{highlightedIds.size} Favorites</span>
            </div>
          ) : highlightedIds && highlightedIds.size > 0 && (
            <div className="legend-item">
              <div className="legend-marker" style={{ backgroundColor: '#FF69B4', width: '10px', height: '10px' }}></div>
              <span>{highlightedIds.size} fit your request</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 