import React from 'react'
import type { Restaurant } from '../types/restaurant'
import './RestaurantCard.css'

interface RestaurantCardProps {
  restaurant: Restaurant | null
  placeholderRestaurant: Restaurant | null
}

export default function RestaurantCard({ restaurant, placeholderRestaurant }: RestaurantCardProps) {
  const displayRestaurant = restaurant || placeholderRestaurant
  if (!displayRestaurant) return null



  const handleSeeMenu = () => {
    if (displayRestaurant.menu_url) {
      window.open(displayRestaurant.menu_url, '_blank')
    }
  }

  const handleLearnMore = () => {
    if (displayRestaurant.website) {
      window.open(displayRestaurant.website, '_blank')
    }
  }

  return (
    <div className="restaurant-card">
      {/* Restaurant Name */}
      <h2 className="restaurant-name">{displayRestaurant.name}</h2>
      
      {/* Restaurant Tags */}
      <div className="restaurant-tags">
        <span className="tag tag-cuisine">{displayRestaurant.cuisine}</span>
        <span className="tag tag-neighborhood">{displayRestaurant.neighborhood}</span>
        {displayRestaurant.michelin_award && (
          <span className={`tag ${displayRestaurant.michelin_award === 'BIB_GOURMAND' ? 'tag-bib-gourmand' : 'tag-michelin'}`}>
            {displayRestaurant.michelin_award === 'BIB_GOURMAND' ? (
              'Bib Gourmand'
            ) : ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(displayRestaurant.michelin_award) ? (
              <div className="michelin-stars">
                {displayRestaurant.michelin_award === 'ONE_STAR' && <img src="/MichelinStar.svg.png" alt="1 Michelin Star" className="michelin-star" />}
                {displayRestaurant.michelin_award === 'TWO_STARS' && (
                  <>
                    <img src="/MichelinStar.svg.png" alt="1 Michelin Star" className="michelin-star" />
                    <img src="/MichelinStar.svg.png" alt="2 Michelin Star" className="michelin-star" />
                  </>
                )}
                {displayRestaurant.michelin_award === 'THREE_STARS' && (
                  <>
                    <img src="/MichelinStar.svg.png" alt="1 Michelin Star" className="michelin-star" />
                    <img src="/MichelinStar.svg.png" alt="2 Michelin Star" className="michelin-star" />
                    <img src="/MichelinStar.svg.png" alt="3 Michelin Star" className="michelin-star" />
                  </>
                )}
              </div>
            ) : null}
          </span>
        )}
      </div>
      {/* Restaurant Description */}
      <p className="restaurant-description">{displayRestaurant.summary}</p>

      {/* Meals Available */}
      {displayRestaurant.meal_types && displayRestaurant.meal_types.length > 0 && (
        <div className="meals-section">
          <h3 className="meals-heading">Meals Available</h3>
          <div className={`meals-list ${displayRestaurant.meal_types.length >= 3 ? 'meals-list-two-columns' : ''}`}>
            {displayRestaurant.meal_types.map((meal, index) => {
              // Clean up meal type text
              const cleanMeal = meal
                .replace(' Price', '')
                .replace('$', '$')
              return (
                <div key={index} className="meal-item">
                  • {cleanMeal}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="restaurant-actions">
        {displayRestaurant.menu_url && (
          <button className="action-link" onClick={handleSeeMenu}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            See Menu
          </button>
        )}
        {displayRestaurant.website && (
          <button className="action-link" onClick={handleLearnMore}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
            LEARN MORE
          </button>
        )}
      </div>
    </div>
  )
} 