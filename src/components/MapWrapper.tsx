import { useState, useEffect } from 'react'
import Map from './Map'
import OfflineMap from './OfflineMap'
import { setupOnlineStatusDetection } from '../utils/pwaUtils'
import type { Restaurant } from '../types/restaurant'

interface MapWrapperProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilters: string[]
  onLegendFilterChange: (filterType: string) => void
  totalRestaurants: number
  favorites: string[]
}

export default function MapWrapper(props: MapWrapperProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [mapError, setMapError] = useState(false)

  useEffect(() => {
    // Set up online/offline detection
    setupOnlineStatusDetection((online) => {
      setIsOnline(online)
      if (online) {
        setMapError(false) // Reset error when coming back online
      }
    })

    // Test Mapbox connectivity
    if (isOnline) {
      fetch('https://api.mapbox.com/v1/status', { mode: 'no-cors' })
        .catch(() => {
          console.log('Mapbox API not available, using offline map')
          setMapError(true)
        })
    }
  }, [isOnline])

  // Use offline map if:
  // 1. Browser is offline
  // 2. Mapbox API is not available
  // 3. User preference (could add toggle in future)
  const shouldUseOfflineMap = !isOnline || mapError

  if (shouldUseOfflineMap) {
    return <OfflineMap {...props} isOnline={isOnline} />
  }

  try {
    return <Map {...props} />
  } catch (error) {
    console.error('Mapbox error, falling back to offline map:', error)
    setMapError(true)
    return <OfflineMap {...props} isOnline={isOnline} />
  }
}