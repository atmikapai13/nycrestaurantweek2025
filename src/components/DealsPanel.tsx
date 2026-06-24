import { useEffect, useMemo } from 'react'
import { Search } from 'lucide-react'
import { useMap, hasAnyAward } from '../contexts/MapContext'
import type { Restaurant } from '../types/restaurant'
import { Input } from '@/components/ui/input'

// Great-circle distance in miles
function distanceMi(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Short label for the $26 deal a restaurant offers (or collectible-only).
function dealLabel(r: Restaurant): string {
  const tags = r.deal_tags ?? []
  if (r.has_26_offer) {
    if (tags.includes('desserts')) return '$26 Dessert'
    if (tags.includes('meal_drink_combo')) return '$26 Meal + Drink'
    if (tags.includes('food_only')) return '$26 Meal'
    if (tags.includes('drink_only')) return '$26 Drink'
    return '$26 Deal'
  }
  return 'World "Cup" Collectible'
}

// Shared deals content — used by the desktop sidebar AND the mobile bottom sheet.
// `introOnly` (mobile) shows just the intro message, hiding search / Top 5 / links.
export default function DealsPanel({
  onSelect,
  introOnly = false,
}: {
  onSelect: (r: Restaurant) => void
  introOnly?: boolean
}) {
  const { filteredRestaurants, userLocation, setUserLocation, searchTerm, setSearchTerm } = useMap()

  // Ask for the visitor's location once (non-blocking) so we can rank by distance.
  useEffect(() => {
    if (!userLocation && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
      )
    }
  }, [userLocation, setUserLocation])

  // Top 5: purely by distance when geolocated, otherwise award-winners first.
  const { top5, byDistance } = useMemo(() => {
    const pool = filteredRestaurants.filter((r) => r.latitude && r.longitude)
    if (userLocation) {
      const sorted = [...pool].sort(
        (a, b) =>
          distanceMi(userLocation.latitude, userLocation.longitude, a.latitude!, a.longitude!) -
          distanceMi(userLocation.latitude, userLocation.longitude, b.latitude!, b.longitude!)
      )
      return { top5: sorted.slice(0, 5), byDistance: true }
    }
    const sorted = [...pool].sort((a, b) => Number(hasAnyAward(b)) - Number(hasAnyAward(a)))
    return { top5: sorted.slice(0, 5), byDistance: false }
  }, [filteredRestaurants, userLocation])

  return (
    <div className="flex flex-col gap-7">
      <p className="sm:mt-4 sm:py-3 text-xl leading-snug font-bold">
        Even during times of austerity, our beloved Mamdani delivers:{' '}
        <span className="font-bold">
          800+ restaurants offer <em className="italic underline">affordable</em> $26 deals and limited
          edition collectibles in celebration of the World Cup!
        </span>
        <br></br>
        <br></br>Remy, your friendly neighbourhood super(rat)man, helps you find the best deals: enjoy
        half-dozen oysters and a glass of wine or a full 3-course meal for just 26 bucks.
      </p>

      {!introOnly && (
        <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <Input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search restaurants…"
          className="h-10 pl-8 text-lg ring-1 ring-ring"
          style={{ fontFamily: 'inherit' }}
        />
      </div>

      <div>
        <div className="px-0 text-xl font-semibold uppercase tracking-widest text-pink-500">
          {byDistance ? "What's near you?" : 'Top 5 picks'}
        </div>
        <ul className="mt-1 flex list-none flex-col gap-0.5 p-0">
          {top5.map((r, i) => (
            <li key={r.slug}>
              <button
                onClick={() => onSelect(r)}
                className="flex w-full cursor-pointer appearance-none items-start gap-2 border-none bg-transparent py-1.5 text-left"
              >
                <span className="w-4 shrink-0 text-base font-bold text-pink-500">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-bold leading-tight text-neutral-800">
                    {r.name}
                  </span>
                  <span className="block truncate text-sm leading-tight text-neutral-500">
                    {dealLabel(r)}
                    {r.neighborhood ? ` · ${r.neighborhood}` : ''}
                    {byDistance && userLocation && r.latitude && r.longitude
                      ? ` (${distanceMi(
                          userLocation.latitude,
                          userLocation.longitude,
                          r.latitude,
                          r.longitude
                        ).toFixed(1)} mi)`
                      : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-0 text-xl font-semibold uppercase tracking-widest text-pink-500">
        Want more?
      </div>
      <p className="-mt-4 py-0 text-lg leading-snug font-bold">
        As a restaurateur, you can participate by{' '}
        <a
          href="https://admintools.nyctourism.com/world-cup-cuisine"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
        >
          registering
        </a>{' '}
        by July 1.
      </p>

      <p className="-mt-4 py-3 text-lg leading-snug font-bold">
        Explore other{' '}
        <a
          href="https://www.nyctourism.com/worldcup26/world-cup-offers-and-events/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
        >
          NYC World Cup events
        </a>{' '}
        or get the{' '}
        <a
          href="https://www.nyctourism.com/worldcup26/the-nyc-neighborhood-passport-world-cup-program/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
        >
          Mamdani's Neighborhood Passport
        </a>
        .
      </p>
        </>
      )}
    </div>
  )
}
