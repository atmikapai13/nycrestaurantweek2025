import { useState, useRef } from 'react'
import type { Restaurant } from '../types/restaurant'
import { asset } from "../utils/asset";
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

// Specific $26 deal label for the offer tag (matches the $26 Offer dropdown options).
function offerLabel(r: Restaurant): string {
  const tags = r.deal_tags ?? []
  if (tags.includes('desserts')) return '$26 Dessert'
  if (tags.includes('meal_drink_combo')) return '$26 Meal + Drink'
  if (tags.includes('food_only')) return '$26 Meal'
  if (tags.includes('drink_only')) return '$26 Drink'
  return '$26 Offer'
}

// The NYC Tourism CDN (Frontify) serves full-resolution originals (~280KB+).
// Request a card-sized WebP instead (~90KB) so the hero image loads fast.
function optimizedImageUrl(url: string, width = 640): string {
  if (!url.includes('media.ffycdn.net')) return url
  return `${url}${url.includes('?') ? '&' : '?'}width=${width}&format=webp`
}

// Format a blob of text into paragraph breaks every couple of sentences.
function formatBody(text: string): string {
  return text.split('. ').reduce((acc: string, sentence: string, index: number, array: string[]) => {
    const sentenceWithPeriod = index === array.length - 1 && sentence.endsWith('.') ? sentence : sentence + '.'
    if (index > 0 && index % 2 === 0) {
      return acc + '\n\n' + sentenceWithPeriod
    }
    return acc + (index > 0 ? ' ' : '') + sentenceWithPeriod
  }, '')
}

export default function RestaurantCard({ restaurant, placeholderRestaurant, onClose, isFavorited = false, onToggleFavorite, onExpandDrawer, collapsible = false }: RestaurantCardProps) {
  const displayRestaurant = restaurant || placeholderRestaurant
  const [isContactsOpen, setIsContactsOpen] = useState(false)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isAccordionSectionOpen, setIsAccordionSectionOpen] = useState(false)

  // Refs for accordion content
  const aboutContentRef = useRef<HTMLDivElement>(null)
  const contactsContentRef = useRef<HTMLDivElement>(null)

  if (!displayRestaurant) return null

  // summary always shows in the main region; summary2 goes in the About tab,
  // which we only show when it actually adds something beyond the summary.
  const summary = (displayRestaurant.summary || '').trim()
  const summary2 = (displayRestaurant.summary2 || '').trim()
  const showAbout = summary2 !== '' && summary2 !== summary

  // Handle About accordion toggle - expand drawer on mobile
  const handleAboutToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newState = !isAboutOpen
    setIsAboutOpen(newState)
    if (newState && onExpandDrawer) {
      onExpandDrawer()
    }
    if (newState && aboutContentRef.current) {
      setTimeout(() => {
        aboutContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 350)
    }
  }

  // Handle +more accordion section toggle - expand drawer on mobile
  const handleAccordionSectionToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newState = !isAccordionSectionOpen
    setIsAccordionSectionOpen(newState)
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
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>
      {/* Hero image */}
      {displayRestaurant.image_url && (
        <img
          src={optimizedImageUrl(displayRestaurant.image_url)}
          alt={displayRestaurant.name}
          loading={collapsible ? 'lazy' : 'eager'}
          decoding="async"
          className="restaurant-card-image"
          style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '10px', marginBottom: '10px', display: 'block' }}
        />
      )}
      {/* Restaurant Name */}
      <h2 className="restaurant-name">
        {displayRestaurant.name}
        {displayRestaurant.michelin_award && ['ONE_STAR', 'TWO_STARS', 'THREE_STARS'].includes(displayRestaurant.michelin_award) && (
          <img src={asset("/MichelinStar.svg.png")} alt="Michelin Star" className="michelin-star-inline" />
        )}
        {displayRestaurant.michelin_award === 'BIB_GOURMAND' && (
          <img src={asset("/bibgourmand.png")} alt="Bib Gourmand" className="bib-gourmand-inline" />
        )}
        {displayRestaurant.nyttop100_rank && (
          <img src={asset("/nytimes.png")} alt="NYT Top 100" className="nyt-top100-inline" />
        )}
      </h2>
      {/* Cuisine + World Cup promotion badges (single wrapping row) */}
      <div className="restaurant-tags">
        {displayRestaurant.cuisine && (
          <span className="tag tag-cuisine">{displayRestaurant.cuisine}</span>
        )}
        {displayRestaurant.limited_edition_cup && (
          <span className="tag tag-resweek">Collectible</span>
        )}
        {displayRestaurant.has_26_offer && (
          <span className="tag tag-nyt-rank">{offerLabel(displayRestaurant)}</span>
        )}
      </div>
      {/* Restaurant Description (summary always shows here) */}
      {summary && (
        <p className="card-body-text review-text">{formatBody(summary)}</p>
      )}

      {/* +more toggle for collapsible cards */}
      {collapsible && (
        <div className="collapsible-actions-row">
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
          {/* About Accordion (only when summary2 adds info beyond the summary) */}
          {showAbout && (
            <div className="about-accordion">
              <button
                className="about-accordion-header"
                onClick={handleAboutToggle}
                aria-expanded={isAboutOpen}
                aria-label="Toggle about"
              >
                <span className="review-accordion-title">World Cup Offer</span>
                <svg
                  className={`about-accordion-chevron ${isAboutOpen ? 'open' : ''}`}
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div ref={aboutContentRef} className={`about-accordion-content ${isAboutOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
                <p className="card-body-text">{formatBody(summary2)}</p>
              </div>
            </div>
          )}

          {/* Contact & Links Accordion */}
          <div className="contact-accordion">
            <button
              className="contact-accordion-header"
              onClick={(e) => {
                e.stopPropagation()
                const newState = !isContactsOpen
                setIsContactsOpen(newState)
                if (newState && onExpandDrawer) {
                  onExpandDrawer()
                }
                if (newState && contactsContentRef.current) {
                  setTimeout(() => {
                    contactsContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  }, 350)
                }
              }}
              aria-expanded={isContactsOpen}
              aria-label="Toggle contact and links"
            >
              <span className="review-accordion-title">Socials</span>
              <svg
                className={`contact-accordion-chevron ${isContactsOpen ? 'open' : ''}`}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
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
