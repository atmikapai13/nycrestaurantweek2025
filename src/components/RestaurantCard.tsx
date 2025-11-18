import type { Restaurant } from '../types/restaurant'
import './RestaurantCard.css'

interface RestaurantCardProps {
  restaurant: Restaurant | null
  placeholderRestaurant?: Restaurant | null
  onClose?: () => void
  isFavorited?: boolean
  onToggleFavorite?: () => void
}

export default function RestaurantCard({ restaurant, placeholderRestaurant, onClose, isFavorited = false, onToggleFavorite }: RestaurantCardProps) {
  const displayRestaurant = restaurant || placeholderRestaurant
  if (!displayRestaurant) return null

  const handleLearnMore = () => {
    if (displayRestaurant.website) {
      window.open(displayRestaurant.website, '_blank')
    }
  }

  return (
    <div className="restaurant-card">
      {onClose && (
        <button className="restaurant-card-close" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="4" x2="16" y2="16" />
            <line x1="16" y1="4" x2="4" y2="16" />
          </svg>
        </button>
      )}
      {onToggleFavorite && (
        <button className="restaurant-card-heart" onClick={onToggleFavorite} aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}>
          {isFavorited ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF69B4" stroke="#FF69B4" strokeWidth="2">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF69B4" strokeWidth="2">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          )}
        </button>
      )}
      {/* Restaurant Name */}
      <h2 className="restaurant-name">
        {displayRestaurant.name}
        {displayRestaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(displayRestaurant.michelin_award) && (
          <img src="MichelinStar.svg.png" alt="Michelin Star" className="michelin-star-inline" />
        )}
        {displayRestaurant.michelin_award === 'BIB_GOURMAND' && (
          <img src="bibgourmand.png" alt="Bib Gourmand" className="bib-gourmand-inline" />
        )}
        {displayRestaurant.nyttop100_rank && (
          <img src="nytimes.png" alt="NYT Top 100" className="nyt-top100-inline" />
        )}
      </h2>
      {/* Restaurant Tags */}
      <div className="restaurant-tags">
        <span className="tag tag-cuisine">{displayRestaurant.cuisine}</span>
        <span className="tag tag-neighborhood">{displayRestaurant.neighborhood}</span>
        {displayRestaurant.nyttop100_rank && (
          <span className="tag tag-nyt-rank">NYT Rank {displayRestaurant.nyttop100_rank}</span>
        )}
      </div>
      {/* Restaurant Description */}
      <p className="restaurant-description" style={{ fontSize: '12px' }}>{displayRestaurant.summary}</p>

      {/* Yelp Rating and Reviews */}
      {(displayRestaurant.yelp_rating && displayRestaurant.yelp_review_count) && (
        <div className="yelp-section">
          <span className="yelp-rating"><b>Yelp:</b> {displayRestaurant.yelp_rating} ({displayRestaurant.yelp_review_count} reviews)</span>
          {displayRestaurant.price && (
            <div className="restaurant-price">
              <b>Price:</b> {displayRestaurant.price}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="restaurant-actions">
        {displayRestaurant.website && (
          <button className="action-link" onClick={handleLearnMore}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
            LEARN MORE
          </button>
        )}
      </div>
      {displayRestaurant.opentable_id && displayRestaurant.opentable_id.trim() !== '' && (
        <a
          className="find-table-btn"
          href={`https://www.opentable.com/restaurant/profile/${displayRestaurant.opentable_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Find a Table
        </a>
      )}
    </div>
  )
} 