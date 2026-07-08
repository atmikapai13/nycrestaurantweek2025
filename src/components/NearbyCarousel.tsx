import { useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant } from '../types/restaurant'
import RestaurantCard from './RestaurantCard'
import { findRestaurantsByGreedyWalk } from '../utils/geospatial'
import './NearbyCarousel.css'

interface Props {
  anchor: Restaurant
  pool: Restaurant[]
  favorites: string[]
  onToggleFavorite: (name: string) => void
  onSelect: (restaurant: Restaurant) => void
  onClose: () => void
}

// How many slots on either side of the centered card get a real, interactive
// RestaurantCard mounted — everything further out is just an empty spacer, so
// swiping through hundreds of restaurants stays cheap (native scroll handles
// the physics; we only ever mount ~5 cards at a time).
const RENDER_WINDOW = 2

// Swipeable "nearby places" carousel — centers on the selected restaurant and
// orders the rest of the current pool by distance from it, so swiping left/
// right moves to the next-closest place (peeking cards on both edges hint
// there's more, matching the native-maps-app pattern).
//
// The sort order is computed once per *external* selection (marker tap,
// search) and stays fixed while swiping — swiping just walks that frozen
// order and reports the centered restaurant back up (so the map marker/etc.
// stay in sync), it does not itself trigger a re-sort. Only a genuinely new
// external anchor (one we didn't just emit ourselves) resets the order.
export default function NearbyCarousel({ anchor, pool, favorites, onToggleFavorite, onSelect, onClose }: Props) {
  const [sortAnchor, setSortAnchor] = useState(anchor)
  const lastEmittedSlug = useRef<string | null>(null)

  const sorted = useMemo(() => {
    if (sortAnchor.longitude == null || sortAnchor.latitude == null) return [sortAnchor]
    return findRestaurantsByGreedyWalk(sortAnchor, pool)
  }, [sortAnchor, pool])

  const [centerIndex, setCenterIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // A new anchor re-centers and re-sorts the carousel — unless it's just the
  // echo of our own onSelect call from swiping, in which case we leave the
  // frozen order and scroll position alone.
  useEffect(() => {
    if (anchor.slug === lastEmittedSlug.current) {
      lastEmittedSlug.current = null
      return
    }
    setSortAnchor(anchor)
    setCenterIndex(0)
    containerRef.current?.scrollTo({ left: 0, behavior: 'auto' })
  }, [anchor.slug])

  const scrollToIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current
    const step = (el?.children[0] as HTMLElement | undefined)?.offsetWidth
    if (!el || !step) return
    el.scrollTo({ left: index * (step + 10), behavior })
  }

  const handleScroll = () => {
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current)
    scrollTimeout.current = setTimeout(() => {
      const el = containerRef.current
      const step = (el?.children[0] as HTMLElement | undefined)?.offsetWidth
      if (!el || !step) return
      const index = Math.round(el.scrollLeft / (step + 10))
      const clamped = Math.max(0, Math.min(sorted.length - 1, index))
      setCenterIndex((prev) => {
        if (prev !== clamped) {
          lastEmittedSlug.current = sorted[clamped].slug
          onSelectRef.current(sorted[clamped])
        }
        return clamped
      })
    }, 120)
  }

  return (
    <div className="nearby-carousel" ref={containerRef} onScroll={handleScroll}>
      {sorted.map((restaurant, i) => {
        const withinWindow = Math.abs(i - centerIndex) <= RENDER_WINDOW
        const isCenter = i === centerIndex
        return (
          <div
            className="nearby-carousel-slot"
            key={restaurant.slug}
            onClick={!isCenter ? () => scrollToIndex(i) : undefined}
          >
            {withinWindow && (
              <RestaurantCard
                restaurant={restaurant}
                isFavorited={favorites.includes(restaurant.name)}
                onToggleFavorite={() => onToggleFavorite(restaurant.name)}
                onClose={isCenter ? onClose : undefined}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
