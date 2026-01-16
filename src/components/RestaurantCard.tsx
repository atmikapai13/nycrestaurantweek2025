import { useState, useRef } from 'react'
import type { Restaurant } from '../types/restaurant'
import './RestaurantCard.css'

interface RestaurantCardProps {
  restaurant: Restaurant | null
  placeholderRestaurant?: Restaurant | null
  onClose?: () => void
  isFavorited?: boolean
  onToggleFavorite?: () => void
  onRequestReviewHighlights?: (prompt: string, slug: string) => void
  onExpandDrawer?: () => void
  collapsible?: boolean // For displayRestaurants cards - hide accordions behind +/- toggle
}

export default function RestaurantCard({ restaurant, placeholderRestaurant, onClose, isFavorited = false, onToggleFavorite, onExpandDrawer, collapsible = false }: RestaurantCardProps) {
  const displayRestaurant = restaurant || placeholderRestaurant
  const [isContactsOpen, setIsContactsOpen] = useState(false)
  const [isReviewsOpen, setIsReviewsOpen] = useState(false)
  const [isRestaurantWeekOpen, setIsRestaurantWeekOpen] = useState(false)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isAccordionSectionOpen, setIsAccordionSectionOpen] = useState(false)

  // Refs for accordion content
  const reviewsContentRef = useRef<HTMLDivElement>(null)
  const restaurantWeekContentRef = useRef<HTMLDivElement>(null)
  const aboutContentRef = useRef<HTMLDivElement>(null)
  const contactsContentRef = useRef<HTMLDivElement>(null)

  if (!displayRestaurant) return null

  // Strip "Yelp categorizes..." first sentence from review highlights and add paragraph breaks
  const processYelpReview = (text: string) => {
    if (!text) return ''
    const sentences = text.split('. ')
    const filteredSentences = sentences[0]?.startsWith('Yelp categorizes')
      ? sentences.slice(1)
      : sentences

    // Add paragraph breaks every 2 sentences
    return filteredSentences.reduce((acc: string, sentence: string, index: number, array: string[]) => {
      const sentenceWithPeriod = index === array.length - 1 && sentence.endsWith('.') ? sentence : sentence + '.';
      if (index > 0 && index % 2 === 0) {
        return acc + '\n\n' + sentenceWithPeriod;
      }
      return acc + (index > 0 ? ' ' : '') + sentenceWithPeriod;
    }, '')
  }

  // Handle review accordion toggle - expand drawer on mobile
  const handleReviewToggle = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent parent click handler from collapsing drawer
    const newState = !isReviewsOpen
    setIsReviewsOpen(newState)

    // Expand drawer to 80vh when opening reviews on mobile
    if (newState && onExpandDrawer) {
      onExpandDrawer()
    }

    // Scroll expanded content into view after animation
    if (newState && reviewsContentRef.current) {
      setTimeout(() => {
        reviewsContentRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }, 350) // Wait for animation to complete (300ms + buffer)
    }
  }

  // Handle Restaurant Week accordion toggle - expand drawer on mobile
  const handleRestaurantWeekToggle = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent parent click handler from collapsing drawer
    const newState = !isRestaurantWeekOpen
    setIsRestaurantWeekOpen(newState)

    // Expand drawer to 80vh when opening accordion
    if (newState && onExpandDrawer) {
      onExpandDrawer()
    }

    // Scroll expanded content into view after animation
    if (newState && restaurantWeekContentRef.current) {
      setTimeout(() => {
        restaurantWeekContentRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }, 350) // Wait for animation to complete (300ms + buffer)
    }
  }

  // Handle About accordion toggle - expand drawer on mobile
  const handleAboutToggle = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent parent click handler from collapsing drawer
    const newState = !isAboutOpen
    setIsAboutOpen(newState)

    // Expand drawer to 80vh when opening accordion
    if (newState && onExpandDrawer) {
      onExpandDrawer()
    }

    // Scroll expanded content into view after animation
    if (newState && aboutContentRef.current) {
      setTimeout(() => {
        aboutContentRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }, 350) // Wait for animation to complete (300ms + buffer)
    }
  }

  // Handle +more accordion section toggle - expand drawer on mobile
  const handleAccordionSectionToggle = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent parent click handler from collapsing drawer
    const newState = !isAccordionSectionOpen
    setIsAccordionSectionOpen(newState)

    // Expand drawer to 80vh when opening on mobile
    if (newState && onExpandDrawer) {
      onExpandDrawer()
    }
  }

  return (
    <div className="restaurant-card">
      {/* Top right buttons */}
      <div className="card-header-buttons">
        {onToggleFavorite && (
          <button className="btn-favorite" onClick={onToggleFavorite} aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorited ? "#FF69B4" : "none"} stroke="#FF69B4" strokeWidth="2.0">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </button>
        )}
        {onClose && (
          <button
            className="btn-close-card"
            onClick={(e) => {
              e.stopPropagation(); // Prevent click from bubbling to parent card
              onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>
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
      </div>
      {/* Restaurant Description */}
      <p className="card-body-text review-text">
        {displayRestaurant.summary && displayRestaurant.summary.split('. ').reduce((acc: string, sentence: string, index: number, array: string[]) => {
          // Add the sentence back with period (except for last one which might already have it)
          const sentenceWithPeriod = index === array.length - 1 && sentence.endsWith('.') ? sentence : sentence + '.';
          // Add double line break every 2 sentences for paragraph breaks
          if (index > 0 && index % 2 === 0) {
            return acc + '\n\n' + sentenceWithPeriod;
          }
          return acc + (index > 0 ? ' ' : '') + sentenceWithPeriod;
        }, '')}
      </p>

      {/* Yelp Rating */}
      {displayRestaurant.yelp_rating != null && displayRestaurant.yelp_rating > 0 && displayRestaurant.yelp_review_count != null && displayRestaurant.yelp_review_count > 0 && (
        <div className="yelp-price-row">
          <span className="card-body-text review-text yelp-info"><b>Yelp:</b> {displayRestaurant.yelp_rating.toFixed(1)}★ ({displayRestaurant.yelp_review_count.toLocaleString()} Reviews)</span>
          {/* Find a Table button - inline for non-collapsible cards */}
          {!collapsible && (displayRestaurant.table_res || displayRestaurant.opentable_id) && (
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
              Reserve
            </a>
          )}
          {/* + more toggle inline with Yelp when collapsible and NO Reserve button */}
          {collapsible && !(displayRestaurant.table_res || displayRestaurant.opentable_id) && (
            <button
              className="accordion-section-toggle"
              onClick={handleAccordionSectionToggle}
              aria-expanded={isAccordionSectionOpen}
              aria-label={isAccordionSectionOpen ? "Collapse details" : "Expand details"}
            >
              <span className="accordion-section-toggle-icon">{isAccordionSectionOpen ? '−' : '+'}</span>
              <span className="accordion-section-toggle-label">{isAccordionSectionOpen ? 'less' : 'more'}</span>
            </button>
          )}
        </div>
      )}

      {/* Reserve + More toggle row for collapsible cards (only when Reserve exists) */}
      {collapsible && (displayRestaurant.table_res || displayRestaurant.opentable_id) && (
        <div className="collapsible-actions-row">
          <a
            href={
              displayRestaurant.table_res && displayRestaurant.table_res.trim() !== ''
                ? displayRestaurant.table_res
                : `https://www.opentable.com/restaurant/profile/${displayRestaurant.opentable_id}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="find-table-btn"
            onClick={(e) => e.stopPropagation()}
          >
            Reserve
          </a>
          <button
            className="accordion-section-toggle"
            onClick={handleAccordionSectionToggle}
            aria-expanded={isAccordionSectionOpen}
            aria-label={isAccordionSectionOpen ? "Collapse details" : "Expand details"}
          >
            <span className="accordion-section-toggle-icon">{isAccordionSectionOpen ? '−' : '+'}</span>
            <span className="accordion-section-toggle-label">{isAccordionSectionOpen ? 'less' : 'more'}</span>
          </button>
        </div>
      )}

      {/* Accordions wrapper - always visible when not collapsible, or when expanded */}
      {(!collapsible || isAccordionSectionOpen) && (
        <>
      {/* Restaurant Week Spring 2026 Accordion */}
      {displayRestaurant.meal_types && displayRestaurant.meal_types.length > 0 && (
        <div className="restaurant-week-accordion">
          <button
            className="restaurant-week-accordion-header"
            onClick={handleRestaurantWeekToggle}
            aria-expanded={isRestaurantWeekOpen}
            aria-label="Toggle Restaurant Week details"
          >
            <span className="restaurant-week-accordion-title">
              <span className="new-badge">NEW</span>
              2026 Restaurant Week
            </span>
            <svg
              className={`restaurant-week-accordion-chevron ${isRestaurantWeekOpen ? 'open' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div ref={restaurantWeekContentRef} className={`restaurant-week-accordion-content ${isRestaurantWeekOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="meal-types-row">
              <div className="card-body-text review-text">
                
                For Spring 2026 Restaurant Week, {displayRestaurant.name} is participating{displayRestaurant.participation_weeks2 && (
                  <> from <b>{displayRestaurant.participation_weeks2}</b></>)}, offering the following menus: <b>{displayRestaurant.meal_types.join(', ')}</b>
              </div>
            </div>
            {displayRestaurant.menu_url && displayRestaurant.menu_url.trim() !== '' && (
              <a
                href={displayRestaurant.menu_url}
                target="_blank"
                rel="noopener noreferrer"
                className="see-menu-btn"
                style={{ display: 'block', marginTop: '8px', marginLeft: 'auto', width: 'fit-content' }}
              >
                See Prix Fixe Menu
              </a>
            )}
          </div>
        </div>
      )}

      {/* Review Highlights Accordion */}
      {(displayRestaurant.yelp_review_highlights || displayRestaurant.reddit) && (
        <div className="review-accordion">
          <button
            className="review-accordion-header"
            onClick={handleReviewToggle}
            aria-expanded={isReviewsOpen}
            aria-label="Toggle reviews"
          >
            <span className="review-accordion-title">Reviews</span>
            <svg
              className={`review-accordion-chevron ${isReviewsOpen ? 'open' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div ref={reviewsContentRef} className={`review-accordion-content ${isReviewsOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
            {displayRestaurant.yelp_review_highlights && (
              <div className="review-item">
                <div className="review-header">
                  <img src="/yelp_logo.png" alt="Yelp" className="review-source-icon" />
                  <span className="review-source-label">Yelp:</span>
                </div>
                <span className="card-body-text review-text">{processYelpReview(displayRestaurant.yelp_review_highlights)}</span>
              </div>
            )}
            {displayRestaurant.reddit && displayRestaurant.reddit.trim() !== '' && (
              <div className="review-item">
                <div className="review-header">
                  <img src="/reddit.webp" alt="Reddit" className="review-source-icon" />
                  <span className="review-source-label">Reddit:</span>
                </div>
                <span className="card-body-text review-text">
                  {displayRestaurant.reddit.split('. ').reduce((acc: string, sentence: string, index: number, array: string[]) => {
                    const sentenceWithPeriod = index === array.length - 1 && sentence.endsWith('.') ? sentence : sentence + '.';
                    if (index > 0 && index % 2 === 0) {
                      return acc + '\n\n' + sentenceWithPeriod;
                    }
                    return acc + (index > 0 ? ' ' : '') + sentenceWithPeriod;
                  }, '')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* About Accordion */}
      {displayRestaurant.summary2 && displayRestaurant.summary2.trim() !== '' && (
        <div className="about-accordion">
          <button
            className="about-accordion-header"
            onClick={handleAboutToggle}
            aria-expanded={isAboutOpen}
            aria-label="Toggle about"
          >
            <span className="about-accordion-title">About</span>
            <svg
              className={`about-accordion-chevron ${isAboutOpen ? 'open' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <div ref={aboutContentRef} className={`about-accordion-content ${isAboutOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
            {/* Award Tags */}
            <div className="about-award-tags" style={{ display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              {displayRestaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(displayRestaurant.michelin_award) && (
                <span className="tag tag-michelin">
                  <img src="/MichelinStar.svg.png" alt="" className="tag-icon" />
                  Michelin
                </span>
              )}
              {displayRestaurant.michelin_award === 'BIB_GOURMAND' && (
                <span className="tag tag-bib">
                  <img src="/bibgourmand.png" alt="" className="tag-icon" />
                  Bib Gourmand
                </span>
              )}
              {displayRestaurant.nyttop100_rank && (
                <span className="tag tag-nyt-rank">
                  <img src="/nytimes.png" alt="" className="tag-icon" />
                  NYT Rank {displayRestaurant.nyttop100_rank}
                </span>
              )}
            </div>
            <p className="card-body-text review-text">
              {displayRestaurant.summary2 && displayRestaurant.summary2.split('. ').reduce((acc: string, sentence: string, index: number, array: string[]) => {
                const sentenceWithPeriod = index === array.length - 1 && sentence.endsWith('.') ? sentence : sentence + '.';
                if (index > 0 && index % 2 === 0) {
                  return acc + '\n\n' + sentenceWithPeriod;
                }
                return acc + (index > 0 ? ' ' : '') + sentenceWithPeriod;
              }, '')}
            </p>
          </div>
        </div>
      )}

      {/* Contact & Links Accordion */}
      <div className="contact-accordion">
        <button
          className="contact-accordion-header"
          onClick={(e) => {
            e.stopPropagation() // Prevent parent click handler from collapsing drawer
            const newState = !isContactsOpen
            setIsContactsOpen(newState)

            // Expand drawer to 80vh when opening accordion on mobile
            if (newState && onExpandDrawer) {
              onExpandDrawer()
            }

            // Scroll expanded content into view after animation
            if (newState && contactsContentRef.current) {
              setTimeout(() => {
                contactsContentRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'nearest'
                })
              }, 350)
            }
          }}
          aria-expanded={isContactsOpen}
          aria-label="Toggle contact and links"
        >
          <span className="contact-accordion-title">Socials</span>
          <svg
            className={`contact-accordion-chevron ${isContactsOpen ? 'open' : ''}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div ref={contactsContentRef} className={`contact-accordion-content ${isContactsOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  )
} 