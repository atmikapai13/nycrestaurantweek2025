import { useMap } from '../contexts/MapContext'
import NearbyCarousel from './NearbyCarousel'
import './MobileRestaurantCard.css'

interface Props {
  onToggleFavorite: (restaurantName: string) => void
}

// Fixed-bottom card for the selected restaurant on mobile. Hidden whenever the
// filter bar or search is expanded, or the Mapbox attribution popup is open,
// so it never fights with them for space. Swipeable — sibling cards are the
// rest of the current pool ordered by distance from the selected restaurant.
export default function MobileRestaurantCard({ onToggleFavorite }: Props) {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    favorites,
    filteredRestaurants,
    filterBarExpanded,
    searchExpanded,
    attributionExpanded,
  } = useMap()

  if (!selectedRestaurant || filterBarExpanded || searchExpanded || attributionExpanded) return null

  return (
    <div className="mobile-restaurant-card">
      <NearbyCarousel
        anchor={selectedRestaurant}
        pool={filteredRestaurants}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        onSelect={setSelectedRestaurant}
        onClose={() => setSelectedRestaurant(null)}
      />
    </div>
  )
}
