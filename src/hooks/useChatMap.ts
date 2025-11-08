import { useCallback } from 'react'
import type { Map } from 'mapbox-gl'
import type { Restaurant } from '../types/restaurant'

interface ChatMapActions {
  focusOnRestaurants: (restaurantIds: string[]) => void
  resetFocus: () => void
  flyToRestaurant: (restaurant: Restaurant) => void
}

export function useChatMap(
  map: Map | null,
  restaurants: Restaurant[]
): ChatMapActions {

  const focusOnRestaurants = useCallback((restaurantIds: string[]) => {
    if (!map || restaurantIds.length === 0) return

    const focusedRestaurants = restaurants.filter(r =>
      restaurantIds.includes(r.slug) && r.latitude && r.longitude
    )

    if (focusedRestaurants.length === 0) return

    // If single restaurant, fly to it
    if (focusedRestaurants.length === 1) {
      const restaurant = focusedRestaurants[0]
      map.flyTo({
        center: [restaurant.longitude!, restaurant.latitude!],
        zoom: 14,
        duration: 1500
      })
    } else {
      // If multiple restaurants, fit bounds to show all
      const coordinates = focusedRestaurants.map(r => [
        r.longitude!,
        r.latitude!
      ]) as [number, number][]

      // Calculate bounds
      const lngs = coordinates.map(c => c[0])
      const lats = coordinates.map(c => c[1])

      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)], // Southwest
        [Math.max(...lngs), Math.max(...lats)]  // Northeast
      ]

      map.fitBounds(bounds, {
        padding: 80,
        duration: 1500,
        maxZoom: 13
      })
    }
  }, [map, restaurants])

  const resetFocus = useCallback(() => {
    if (!map) return
    // Reset to NYC overview
    map.flyTo({
      center: [-73.9712, 40.7831],
      zoom: 11,
      duration: 1500
    })
  }, [map])

  const flyToRestaurant = useCallback((restaurant: Restaurant) => {
    if (!map || !restaurant.latitude || !restaurant.longitude) return

    map.flyTo({
      center: [restaurant.longitude, restaurant.latitude],
      zoom: 15,
      duration: 1500
    })
  }, [map])

  return { focusOnRestaurants, resetFocus, flyToRestaurant }
}
