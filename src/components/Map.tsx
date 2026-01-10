import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
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

// Helper function to check if restaurant has any award
const hasAnyAward = (restaurant: Restaurant): boolean => {
  const hasMichelin = restaurant.michelin_award &&
    ['ONE_STAR', 'TWO_STARS', 'THREE_STARS', 'BIB_GOURMAND'].includes(restaurant.michelin_award)
  const hasNYT = Boolean(restaurant.nyttop100_rank && restaurant.nyttop100_rank !== '')
  return hasMichelin || hasNYT
}

// Compare two GeoJSON polygons for equality
const arePolygonsEqual = (poly1: any, poly2: any): boolean => {
  if (!poly1 && !poly2) return true
  if (!poly1 || !poly2) return false

  // Compare stringified versions for deep equality
  // This handles both Polygon and MultiPolygon geometries
  return JSON.stringify(poly1) === JSON.stringify(poly2)
}

interface MapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  favorites: string[]
  onToggleFavorite?: (restaurantName: string) => void
  onFilterChange: (filterType: string, values: string[]) => void
  allRestaurants: Restaurant[]
  selectedRestaurant?: Restaurant | null
  onResetAll?: () => void
  mapResetRef?: React.MutableRefObject<(() => void) | null>
  highlightedIds?: Set<string>
  onIsochroneRegion?: (slugs: string[] | null) => void
  isochroneRegionSlugs?: string[] | null
  favoritesActive?: boolean
  onFavoritesToggle?: () => void
}

export default function Map({
  restaurants,
  onRestaurantSelect,
  favorites,
  onToggleFavorite,
  onFilterChange,
  allRestaurants,
  selectedRestaurant,
  onResetAll,
  mapResetRef,
  highlightedIds,
  onIsochroneRegion,
  isochroneRegionSlugs,
  favoritesActive,
  onFavoritesToggle
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])
  const markerElements = useRef<HTMLDivElement[]>([])
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null)

  // Refs for tracking previous isochrone states to prevent unnecessary re-renders
  const previousPolygon = useRef<any>(null)
  const previousLayers = useRef<IsochroneLayer[]>([])

  // Backward compatible: keep single polygon state for existing isochrone queries
  const [isochronePolygon, setIsochronePolygon] = useState<any>(null)

  // Track whether to fitBounds when rendering isochrone (default: true for new isochrones, false for preserved)
  const shouldFitBoundsRef = useRef<boolean>(true)

  // New: multi-layer state for Phase 3 spatial operations
  const [isochroneLayers, setIsochroneLayers] = useState<IsochroneLayer[]>([])

  // Track selected restaurant for purple marker indicator
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState<string | null>(null)

  // Wrapper function to update isochrone with fitBounds control
  const handleIsochroneUpdate = useCallback((polygon: any, fitBounds?: boolean) => {
    setIsochronePolygon(polygon)
    // If fitBounds is explicitly set to false, don't fit bounds (preserved isochrone)
    // If undefined or true, fit bounds (new isochrone)
    shouldFitBoundsRef.current = fitBounds !== false
  }, [])

  // Function to reset map state (isochrones and view)
  const resetMapView = () => {
    // Clear isochrone polygons
    setIsochronePolygon(null)
    setIsochroneLayers([])

    // Clear selected restaurant
    setSelectedRestaurantSlug(null)

    // Detect mobile viewport
    const isMobile = window.innerWidth <= 768

    // Use EXACT same values as initial map setup (lines 212-221)
    const center = isMobile ? [-73.990, 40.705] : [-74.014, 40.737] //change
    const zoom = isMobile ? 11.5 : 12.1  // Mobile: 11.5, Desktop: 12.58
    const pitch = 45
    const bearing = 0

    // Reset map to default view (mobile or desktop)
    if (map.current) {
      // Create a small bounding box around the center point
      // This allows us to use fitBounds with padding (same as isochrone operations)
      const lng = center[0]
      const lat = center[1]
      const offset = 0.05 // Small offset to create bounds (~5km)

      const bounds = new mapboxgl.LngLatBounds(
        [lng - offset, lat - offset], // Southwest
        [lng + offset, lat + offset]  // Northeast
      )

      // Use fitBounds with padding to account for chat interface
      // This matches the padding used in isochrone operations (lines 367-372)
      // Force exact zoom level to match initial map setup
      map.current.fitBounds(bounds, {
        padding: isMobile
          ? { top: 80, bottom: 320, left: 20, right: 20 }  // Mobile: pad bottom for drawer (40vh ≈ 320px)
          : { top: 100, bottom: 100, left: 700, right: 100 }, // Desktop: pad left for chat panel
        pitch,
        bearing,
        maxZoom: zoom,  // Force exact zoom level
        minZoom: zoom,  // Force exact zoom level
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
          ? { top: 80, bottom: 320, left: 20, right: 20 }  // Mobile: pad bottom for drawer (40vh ≈ 320px)
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
    if (isMobileDevice && zoom >= 13) {
      size *= 1.8
    } else if (zoom >= 12.0) {
      size *= 1.4
    }
    // Increase size in desktop when zoomed in
    if (!isMobileDevice && zoom >= 13.5) {
      size *= 1.2
    } else if (zoom >= 12.0) {
      size *= 0.8
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
    const mobileCenter: [number, number] = [-73.990, 40.705] // Shifted south to show lower Manhattan
    const mobileZoom = 11.5
    const mobilePitch = 45
    const mobileBearing = 0

    // Desktop viewport
    const desktopCenter: [number, number] = [-74.025, 40.755]
    const desktopZoom = 11.8
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

    // Skip re-render if polygon hasn't changed (only log if there's actually a polygon)
    if (arePolygonsEqual(isochronePolygon, previousPolygon.current)) {
      if (isochronePolygon) {
        console.log('🔄 Skipping isochrone re-render - polygon unchanged')
      }
      return
    }

    // Update ref for next comparison
    previousPolygon.current = isochronePolygon

    const sourceId = 'isochrone-polygon'
    const fillLayerId = 'isochrone-fill'
    const outlineLayerId = 'isochrone-outline'

    // Wait for map to load before adding layers
    const updatePolygon = () => {
      const mapInstance = map.current!

      // Remove existing single polygon layers and source if they exist
      if (mapInstance.getLayer(fillLayerId)) {
        mapInstance.removeLayer(fillLayerId)
      }
      if (mapInstance.getLayer(outlineLayerId)) {
        mapInstance.removeLayer(outlineLayerId)
      }
      if (mapInstance.getSource(sourceId)) {
        mapInstance.removeSource(sourceId)
      }

      // CRITICAL: Also clear multi-layer isochrones when showing single isochrone
      // This ensures multi-layers are removed regardless of useEffect execution order
      const existingLayers = mapInstance.getStyle().layers.filter((l: any) =>
        l.id.startsWith('isochrone-') && (l.id.includes('-person') || l.id.includes('-exclusion') || l.id.includes('-intersection') || l.id.includes('-union'))
      )
      existingLayers.forEach((layer: any) => {
        if (mapInstance.getLayer(layer.id)) {
          mapInstance.removeLayer(layer.id)
        }
      })

      const existingSources = Object.keys(mapInstance.getStyle().sources || {}).filter((s: string) =>
        s.startsWith('isochrone-') && (s.includes('-person') || s.includes('-exclusion') || s.includes('-intersection') || s.includes('-union'))
      )
      existingSources.forEach((source: string) => {
        if (mapInstance.getSource(source)) {
          mapInstance.removeSource(source)
        }
      })

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
            'fill-color': '#FF69B4', // Pink
            'fill-opacity': 0.2
          }
        })

        // Add outline layer
        mapInstance.addLayer({
          id: outlineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#FF69B4', // Pink
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

          // Only fitBounds if we actually added coordinates AND shouldFitBounds is true
          if (!bounds.isEmpty() && shouldFitBoundsRef.current) {
            console.log('📍 Fitting bounds to isochrone polygon')
            const isMobileView = window.innerWidth <= 768
            mapInstance.fitBounds(bounds, {
              padding: isMobileView
                ? { top: 80, bottom: 320, left: 20, right: 20 }  // Mobile: pad bottom for drawer (40vh ≈ 320px)
                : { top: 100, bottom: 100, left: 700, right: 100 }, // Desktop: pad left for chat panel
              maxZoom: 14
            })
          } else if (!bounds.isEmpty()) {
            console.log('📍 Skipping fitBounds - preserving current view (isochrone preserved)')
          }
        } catch (error) {
          console.error('Error fitting bounds to isochrone polygon:', error)
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

    // Compare layer arrays (check length and each layer's polygon)
    const layersEqual = isochroneLayers.length === previousLayers.current.length &&
      isochroneLayers.every((layer, i) =>
        arePolygonsEqual(layer.polygon, previousLayers.current[i]?.polygon)
      )

    if (layersEqual) {
      // Only log if there are actually layers to skip (not empty arrays)
      if (isochroneLayers.length > 0) {
        console.log('🔄 Skipping multi-layer re-render - layers unchanged')
      }
      return
    }

    // Update ref for next comparison
    previousLayers.current = isochroneLayers

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
              ? { top: 80, bottom: 320, left: 20, right: 20 }  // Mobile: pad bottom for drawer (40vh ≈ 320px)
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

    // Determine which restaurants to render based on active modes
    let restaurantsToRender: Restaurant[];

    // Determine base pool: if isochrone is active, scope to isochrone restaurants first
    const basePool = isochroneRegionSlugs
      ? restaurants.filter(r => isochroneRegionSlugs.includes(r.slug))
      : restaurants;

    // Favorites mode: only show favorited restaurants
    if (favoritesActive) {
      restaurantsToRender = basePool.filter(r => favorites.includes(r.name));
    } else {
      // No filter modes: show base pool (all restaurants or isochrone restaurants)
      restaurantsToRender = basePool;
    }

    // Render restaurants with coordinates
    restaurantsToRender.forEach(restaurant => {
      if (restaurant.latitude && restaurant.longitude) {
        // 5-TIER COLOR PRIORITY: Purple (selected) > Yellow/Orange (highlighted) > Pink (favorites) > Red (award winners) > Grey (default)
        const isHighlighted = highlightedIds?.has(restaurant.slug)
        const isSelected = selectedRestaurantSlug === restaurant.slug
        const isFavorite = favorites.includes(restaurant.name)
        const isAwardWinner = hasAnyAward(restaurant)

        let markerColor = '#7c7c7c'  // Default grey
        let markerSize = '8px'       // Uniform size for all markers (when zoomed out)
        let zIndex = 0

        if (isSelected) {
          // Selected restaurant: purple marker
          markerColor = '#8b4dfe'    // Purple
          zIndex = 4                 // Highest priority
        } else if (isHighlighted) {
          // Highlighted restaurants (search/filter results): yellow/orange marker
          markerColor = '#FF9100'    // Yellow/Orange
          zIndex = 3                 // Second highest priority
        } else if (isFavorite) {
          // Favorited restaurant: pink marker
          markerColor = '#FF69B4'    // Pink
          zIndex = 2                 // Third priority
        } else if (isAwardWinner) {
          // Award winners (Michelin/NYT): red marker
          markerColor = '#c81224'    // Red
          zIndex = 1                 // Fourth priority
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
            setSelectedRestaurantSlug(null)  // Clear selection
            return
          }

          // Update selection state (triggers marker re-render)
          setSelectedRestaurantSlug(restaurant.slug)

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
  }, [allRestaurants, highlightedIds, onRestaurantSelect, isochroneRegionSlugs, selectedRestaurantSlug, favoritesActive, favorites])

  // Calculate filtered restaurant count (respects both isochrone and FilterBar filters)
  const restaurantCount = useMemo(() => {
    if (isochroneRegionSlugs) {
      // Count filtered restaurants that are in the isochrone
      return restaurants.filter(r => isochroneRegionSlugs.includes(r.slug)).length
    }
    // No isochrone: show filtered restaurants count (filter bar may be active)
    return restaurants.length
  }, [restaurants, isochroneRegionSlugs])

  // Calculate award winners count (respect both isochrone and FilterBar filters)
  const awardWinnersCount = useMemo(() => {
    const pool = isochroneRegionSlugs
      ? restaurants.filter(r => isochroneRegionSlugs.includes(r.slug))
      : restaurants

    return pool.filter(r => hasAnyAward(r)).length
  }, [restaurants, isochroneRegionSlugs])

  // Calculate favorites count (respect both isochrone and FilterBar filters)
  const favoritesCount = useMemo(() => {
    const pool = isochroneRegionSlugs
      ? restaurants.filter(r => isochroneRegionSlugs.includes(r.slug))
      : restaurants

    return pool.filter(r => favorites.includes(r.name)).length
  }, [restaurants, isochroneRegionSlugs, favorites])

  // Calculate highlighted count (respect both isochrone and FilterBar filters)
  const highlightedCount = useMemo(() => {
    if (!highlightedIds || highlightedIds.size === 0) return 0

    const pool = isochroneRegionSlugs
      ? restaurants.filter(r => isochroneRegionSlugs.includes(r.slug))
      : restaurants

    return pool.filter(r => highlightedIds.has(r.slug)).length
  }, [restaurants, isochroneRegionSlugs, highlightedIds])

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
        onIsochroneUpdate={handleIsochroneUpdate}
        onIsochroneLayersUpdate={setIsochroneLayers}
        onResetAll={onResetAll}
        isochroneRegionSlugs={isochroneRegionSlugs}
        onIsochroneRegion={onIsochroneRegion}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        favoritesActive={favoritesActive}
        onFavoritesToggle={onFavoritesToggle}
      />

    </div>
  )
} 