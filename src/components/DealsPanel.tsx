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
  const { allRestaurants, filteredRestaurants, userLocation, setUserLocation, searchTerm, setSearchTerm } = useMap()

  // Open a specific restaurant's card on the map by slug (used by the inline deal links).
  const openBySlug = (slug: string) => {
    const match = allRestaurants.find((r) => r.slug === slug)
    if (match) onSelect(match)
  }

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
      <div className="flex flex-col gap-3 sm:mt-4 sm:py-3 text-base sm:text-lg leading-snug font-normal sm:font-semibold">
        <p className="font-semibold sm:hidden">Welcome to NYC Eats — World Cup Edition!</p>
        <p>
          800+ restaurants offer <em className="italic text-pink-500">affordable $26 deals </em>and limited
          edition collectibles in celebration of the World Cup. <br></br>All hail Mamdani.
        </p>
        <p>
          <span className="sm:hidden">And I, Remy, help</span>
          <span className="hidden sm:inline">And Remy helps</span>
          {' '}you find the best experiences from oysters and martini at{' '}
          <button
            type="button"
            onClick={() => openBySlug('fbws-francie')}
            className="cursor-pointer appearance-none border-none bg-transparent p-0 text-inherit"
            style={{ font: 'inherit' }}
          >
          Francie, a Michelin 1-star,
          </button>{' '}
          to full meals at {' '}
          <button
            type="button"
            onClick={() => openBySlug('fbws-grotta-azzurra')}
            className="cursor-pointer appearance-none border-none bg-transparent p-0 text-inherit"
            style={{ font: 'inherit' }}
          >
            Grotta Azzurra,
          </button>{' '}
          all for 26 bucks.
        </p>
      </div>

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
          {byDistance ? "NEAR YOU" : 'Top 5 picks'}
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
        And more...
      </div>
      <p className="-mt-4 py-0 text-lg leading-snug font-bold">
        As a restaurateur, you can participate by{' '}
        <a
          href="https://admintools.nyctourism.com/world-cup-cuisine"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
          style={{ textDecoration: "none" }}
        >
          registering
        </a>{' '}
        by July 1.
      </p>

      <p className="-mt-4 py-3 text-lg leading-snug font-bold">
        Mamdani's also got {' '}
        <a
          href="https://www.nyctourism.com/worldcup26/world-cup-offers-and-events/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
          style={{ textDecoration: "none" }}
        >
         World Cup events
        </a>{' '}
        or {' '}
        <a
          href="https://www.nyctourism.com/worldcup26/the-nyc-neighborhood-passport-world-cup-program/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500"
          style={{ textDecoration: "none" }}
        >
        Neighborhood Passport program
        </a>
        .
      </p>
        </>
      )}
    </div>
  )
}
