import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMap } from '../contexts/MapContext'
import { asset } from '../utils/asset'
import './MobileOnboarding.css'

const MS_PER_CHAR = 45 // classic Game Boy/Pokémon dialogue-box pace

type Segment = { text: string; className?: string } | { break: true }

interface Card {
  title?: string // shown instantly, never typed
  body: Segment[]
}

const CARDS: Card[] = [
  {
    title: 'Welcome to NYC Eats — World Cup Edition!',
    body: [
      { text: '800+ restaurants offer ' },
      { text: 'affordable $26 deals', className: 'mobile-onboarding-highlight' },
      { text: ' and limited edition collectibles in celebration of the World Cup.' },
      { break: true },
      { break: true },
      { text: ' All thanks to Mamdani!' }
    ],
  },
  {
    body: [
      { text: 'And I, Remy, help you find the best experiences.' },
      { break: true },
      { break: true },
      {
        text: 'From oysters and martini at Francie, a Michelin 1-star, to full meals at Grotta Azzurra, enjoy it all for 26 bucks!',
      },
    ],
  },
  {
    body: [
      {
        text: 'Click on Refine above to find the best deals.',
      },
      { break: true },
      { break: true },
      { text: 'Or hit a restaurant in the map to learn more about their specials. ' },
      { break: true },
      { break: true },
      { text: 'Enjoy, and share with your friends!' }
    ],
  },
]

// A line break counts as one "keystroke" so its timing lines up with the rest of the type-out.
function segmentLength(seg: Segment): number {
  return 'break' in seg ? 1 : seg.text.length
}

function totalLength(body: Segment[]): number {
  return body.reduce((sum, seg) => sum + segmentLength(seg), 0)
}

function renderTyped(body: Segment[], charsShown: number): ReactNode[] {
  let remaining = charsShown
  const nodes: ReactNode[] = []
  body.forEach((seg, i) => {
    if ('break' in seg) {
      if (remaining > 0) nodes.push(<br key={i} />)
      remaining -= 1
      return
    }
    const takeLen = Math.max(0, Math.min(seg.text.length, remaining))
    if (takeLen > 0) {
      nodes.push(
        <span key={i} className={seg.className}>
          {seg.text.slice(0, takeLen)}
        </span>
      )
    }
    remaining -= seg.text.length
  })
  return nodes
}

// First-run tutorial shown over the map on mobile. Dismisses itself the moment
// the user takes any real action (selects a restaurant, filters, or searches)
// so it never blocks the app — only Skip/finishing the last card close it otherwise.
export default function MobileOnboarding() {
  const { selectedRestaurant, activeFilters, searchTerm, setOnboardingRefineHint } = useMap()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [charsShown, setCharsShown] = useState(0)
  const [typedIndex, setTypedIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const card = CARDS[index]
  const bodyLength = totalLength(card.body)
  const isLast = index === CARDS.length - 1

  // Reset synchronously (during render, not in an effect) so the new card never
  // briefly renders with the previous card's leftover charsShown count.
  if (index !== typedIndex) {
    setTypedIndex(index)
    setCharsShown(0)
  }

  const isTyping = charsShown < bodyLength

  // Point the Refine button hint while the last card (which references it) is up.
  useEffect(() => {
    setOnboardingRefineHint(isLast && !dismissed)
    return () => setOnboardingRefineHint(false)
  }, [isLast, dismissed, setOnboardingRefineHint])

  useEffect(() => {
    if (selectedRestaurant || Object.keys(activeFilters).length > 0 || searchTerm.trim() !== '') {
      setDismissed(true)
    }
  }, [selectedRestaurant, activeFilters, searchTerm])

  // Type out the current card's body one character at a time.
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCharsShown((c) => {
        if (c + 1 >= bodyLength && timerRef.current) {
          clearInterval(timerRef.current)
        }
        return c + 1
      })
    }, MS_PER_CHAR)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [index, bodyLength])

  if (dismissed) return null

  // Tap the card: mid-type it instantly finishes the message; once finished, it advances.
  const handleTap = () => {
    if (isTyping) {
      if (timerRef.current) clearInterval(timerRef.current)
      setCharsShown(bodyLength)
      return
    }
    if (isLast) {
      setDismissed(true)
    } else {
      setIndex((i) => i + 1)
    }
  }

  return (
    <div className="mobile-onboarding">
      <div className="mobile-onboarding-inner">
        <button type="button" className="mobile-onboarding-skip" onClick={() => setDismissed(true)}>
          Skip
        </button>
        <div
          className="mobile-onboarding-card"
          onClick={handleTap}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleTap()
          }}
        >
          <img src={asset('/remi.png')} alt="Remi" className="mobile-onboarding-avatar" />
          <div className="mobile-onboarding-text">
            {card.title && <strong>{card.title}</strong>}
            <p>
              {renderTyped(card.body, charsShown)}
              {isTyping && <span className="mobile-onboarding-cursor" />}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
