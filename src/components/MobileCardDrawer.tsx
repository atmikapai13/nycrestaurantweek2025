import { useEffect, useRef, useState } from 'react'
import { useMap } from '../contexts/MapContext'
import RestaurantCard from './RestaurantCard'
import DealsPanel from './DealsPanel'
import { asset } from '../utils/asset'
import type { Restaurant } from '../types/restaurant'
import './MobileCardDrawer.css'

// Persistent bottom sheet. Snap heights (vh): peek / half / full.
const SNAP_POINTS = [16, 55, 90]
const DEFAULT_OPEN = 55

interface Props {
  selectedRestaurant: Restaurant | null
  onSelect: (r: Restaurant) => void
  onCloseCard: () => void
  isFavorited: boolean
  onToggleFavorite: () => void
}

export default function MobileCardDrawer({
  selectedRestaurant,
  onSelect,
  onCloseCard,
  isFavorited,
  onToggleFavorite,
}: Props) {
  const { drawerHeight, setDrawerHeight } = useMap()
  const [dragging, setDragging] = useState(false)
  const drag = useRef({ startY: 0, startH: 0, lastH: 0, active: false })
  const cardRef = useRef<HTMLDivElement>(null)

  // Open to the default height on mount.
  useEffect(() => {
    setDrawerHeight(DEFAULT_OPEN)
  }, [setDrawerHeight])

  // On selection: ensure the sheet is at least half-open and scroll the carousel into view.
  useEffect(() => {
    if (!selectedRestaurant) return
    setDrawerHeight(h => (h < DEFAULT_OPEN ? DEFAULT_OPEN : h))
    requestAnimationFrame(() =>
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }, [selectedRestaurant, setDrawerHeight])

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, startH: drawerHeight, lastH: drawerHeight, active: true }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return
    const dy = e.clientY - drag.current.startY
    const vh = window.innerHeight / 100
    const next = Math.max(SNAP_POINTS[0], Math.min(92, drag.current.startH - dy / vh))
    drag.current.lastH = next
    setDrawerHeight(next)
  }

  const onPointerUp = () => {
    if (!drag.current.active) return
    drag.current.active = false
    setDragging(false)
    const h = drag.current.lastH
    const nearest = SNAP_POINTS.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a))
    setDrawerHeight(nearest)
  }

  return (
    <div
      className="mobile-card-drawer"
      style={{ height: `${drawerHeight}vh`, transition: dragging ? 'none' : 'height 0.25s ease' }}
    >
      <div
        className="mobile-card-drawer-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="mobile-card-drawer-grip" />
      </div>
      <div className="mobile-card-drawer-content">
        {/* Permanent Remi chat message */}
        <div className="deals-chat-message">
          <div className="deals-chat-avatar">
            <img src={asset('/remi.png')} alt="Remi" />
          </div>
          <div className="deals-chat-bubble">
            <DealsPanel onSelect={onSelect} introOnly />
          </div>
        </div>

        {/* Tapped restaurant card rendered below the Remi message */}
        {selectedRestaurant && (
          <div className="drawer-card-wrapper" ref={cardRef}>
            <RestaurantCard
              restaurant={selectedRestaurant}
              onClose={onCloseCard}
              isFavorited={isFavorited}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        )}
      </div>
    </div>
  )
}
