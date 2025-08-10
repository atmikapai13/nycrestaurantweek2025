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

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  // Use Mapbox when online, OSM when offline
  const shouldUseOSM = !isOnline

  if (shouldUseOSM) {
    return <OSMMap {...props} isOffline={!isOnline} />
  }

  return <Map {...props} />
}
