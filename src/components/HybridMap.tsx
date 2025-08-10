import { useState, useEffect } from 'react'
import Map from './Map'
import OSMMap from './OSMMap'
import type { Restaurant } from '../types/restaurant'

interface HybridMapProps {
  restaurants: Restaurant[]
  onRestaurantSelect: (restaurant: Restaurant) => void
  activeFilters: string[]
  onLegendFilterChange: (filterType: string) => void
  totalRestaurants: number
  favorites: string[]
}

export default function HybridMap(props: HybridMapProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [mapboxLoaded, setMapboxLoaded] = useState(false)

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    // Check if Mapbox is available
    const checkMapbox = () => {
      if ((window as any).mapboxgl) {
        setMapboxLoaded(true)
      } else {
        // Retry after a short delay
        setTimeout(checkMapbox, 100)
      }
    }
    checkMapbox()

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  // Use Mapbox when online and loaded, OSM when offline or Mapbox not available
  const shouldUseOSM = !isOnline || !mapboxLoaded

  if (shouldUseOSM) {
    return <OSMMap {...props} isOffline={!isOnline} />
  }

  return <Map {...props} />
}
