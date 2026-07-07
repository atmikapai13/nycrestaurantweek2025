import { useMap } from '../contexts/MapContext'
import RestaurantCard from './RestaurantCard'
import './MobileRestaurantCard.css'

interface Props {
  onToggleFavorite: (restaurantName: string) => void
}

// Fixed-bottom card for the selected restaurant on mobile. Hidden whenever the
// filter bar or search is expanded, or the Mapbox attribution popup is open,
// so it never fights with them for space.
export default function MobileRestaurantCard({ onToggleFavorite }: Props) {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    favorites,
    filterBarExpanded,
    searchExpanded,
    attributionExpanded,
  } = useMap()

  if (!selectedRestaurant || filterBarExpanded || searchExpanded || attributionExpanded) return null

  return (
    <div className="mobile-restaurant-card">
      <RestaurantCard
        restaurant={selectedRestaurant}
        onClose={() => setSelectedRestaurant(null)}
        isFavorited={favorites.includes(selectedRestaurant.name)}
        onToggleFavorite={() => onToggleFavorite(selectedRestaurant.name)}
      />
    </div>
  )
}
