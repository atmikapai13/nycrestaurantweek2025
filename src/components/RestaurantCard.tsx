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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#EB213E" stroke="#EB213E" strokeWidth="2">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EB213E" strokeWidth="2.5">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          )}
        </button>
      )}
      {/* Restaurant Name */}
      <h2 className="restaurant-name">
        {displayRestaurant.name}
        {displayRestaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(displayRestaurant.michelin_award) && (
          <img src="/MichelinStar.svg.png" alt="Michelin Star" className="michelin-star-inline" />
        )}
        {displayRestaurant.michelin_award === 'BIB_GOURMAND' && (
          <img src="/bibgourmand.png" alt="Bib Gourmand" className="bib-gourmand-inline" />
        )}
        {displayRestaurant.nyttop100_rank && (
          <img src="/nytimes.png" alt="NYT Top 100" className="nyt-top100-inline" />
        )}
      </h2>
      {/* Restaurant Tags */}
      <div className="restaurant-tags">
        <span className="tag tag-cuisine">{displayRestaurant.cuisine}</span>
        {displayRestaurant.price && (
          <span className="tag tag-price">{displayRestaurant.price}</span>
        )}
        {displayRestaurant.nyttop100_rank && (
          <span className="tag tag-nyt-rank">NYT Rank {displayRestaurant.nyttop100_rank}</span>
        )}
      </div>
      {/* Restaurant Description */}
      <p className="restaurant-description" style={{ fontSize: '12px' }}>{displayRestaurant.summary}</p>

      {/* Yelp Rating */}
      {displayRestaurant.yelp_rating && displayRestaurant.yelp_review_count && (
        <div className="yelp-price-row">
          <span className="yelp-info"><b>Yelp:</b> {displayRestaurant.yelp_rating.toFixed(1)}★ ({displayRestaurant.yelp_review_count.toLocaleString()} Reviews)</span>
        </div>
      )}

      {/* Social/Contact Icons Row */}
      <div className="restaurant-icons-row">
        {displayRestaurant.website && (
          <a href={displayRestaurant.website} target="_blank" rel="noopener noreferrer" className="icon-link" title="Website">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </a>
        )}
        {displayRestaurant.instagram_url && (
          <a href={displayRestaurant.instagram_url} target="_blank" rel="noopener noreferrer" className="icon-link" title="Instagram">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
            </svg>
          </a>
        )}
        {displayRestaurant.facebook_url && (
          <a href={displayRestaurant.facebook_url} target="_blank" rel="noopener noreferrer" className="icon-link" title="Facebook">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
            </svg>
          </a>
        )}
        {displayRestaurant.telephone && (
          <a href={`tel:${displayRestaurant.telephone}`} className="icon-link" title="Call">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </a>
        )}
        {displayRestaurant.yelp_url && (
          <a href={displayRestaurant.yelp_url} target="_blank" rel="noopener noreferrer" className="icon-link icon-yelp" title="Yelp">
            <img src="/yelp.png" alt="Yelp" style={{ width: '14px', height: '14px', objectFit: 'contain' }} />
          </a>
        )}
        {displayRestaurant.latitude && displayRestaurant.longitude && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${displayRestaurant.latitude},${displayRestaurant.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-link"
            title="Google Maps"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </a>
        )}
        {(displayRestaurant.table_res || displayRestaurant.opentable_id) && (
          <a
            href={
              displayRestaurant.table_res && displayRestaurant.table_res.trim() !== ''
                ? displayRestaurant.table_res
                : `https://www.opentable.com/restaurant/profile/${displayRestaurant.opentable_id}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="find-table-btn"
          >
            Find a Table
          </a>
        )}
      </div>
    </div>
  )
} 