import { useEffect, useState, type ReactNode } from 'react'
import { useMap } from '../contexts/MapContext'
import { asset } from '../utils/asset'
import './MobileOnboarding.css'

type Segment = { text: string; className?: string } | { break: true }

interface Card {
  title?: string
  body: Segment[]
  pointsAtRefine?: boolean // shows the bouncing hint arrow + spotlight on Refine
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
    pointsAtRefine: true,
    body: [
      {
        text: 'Click on Refine above to find the best deals. ',
      },
      { break: true },
      { break: true },
      {
        text: 'Or search for a restaurant.',
      },
    ],
  },
  {
    body: [
      {
        text: 'Or click on a restaurant in the map to learn about their delicious deals.',
      },
      { break: true },
      { break: true },
      {
        text: 'Enjoy, and share with your friends!',
      },
      
      
    ],
  },
]

function renderBody(body: Segment[]): ReactNode[] {
  return body.map((seg, i) => {
    if ('break' in seg) return <br key={i} />
    return (
      <span key={i} className={seg.className}>
        {seg.text}
      </span>
    )
  })
}

// First-run tutorial shown over the map on mobile. Dismisses itself the moment
// the user takes any real action (selects a restaurant, filters, or searches)
// so it never blocks the app — only Skip/finishing the last card close it otherwise.
export default function MobileOnboarding() {
  const { selectedRestaurant, activeFilters, searchTerm, setOnboardingRefineHint, attributionExpanded } = useMap()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const card = CARDS[index]
  const isLast = index === CARDS.length - 1

  // Point the Refine button hint while the card referencing it is up.
  useEffect(() => {
    setOnboardingRefineHint(!!card.pointsAtRefine && !dismissed)
    return () => setOnboardingRefineHint(false)
  }, [card, dismissed, setOnboardingRefineHint])

  useEffect(() => {
    if (selectedRestaurant || Object.keys(activeFilters).length > 0 || searchTerm.trim() !== '') {
      setDismissed(true)
    }
  }, [selectedRestaurant, activeFilters, searchTerm])

  if (dismissed || attributionExpanded) return null

  const handleTap = () => {
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
            <p>{renderBody(card.body)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
