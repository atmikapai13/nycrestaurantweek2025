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

// Price-only label for the prix fixe deal a restaurant offers, e.g. "$30" or "$30-$60".
function dealLabel(r: Restaurant): string {
  const prices = Array.from(
    new Set((r.meal_types ?? []).map((m) => m.match(/^\$\d+/)?.[0]).filter((p): p is string => !!p))
  ).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  if (prices.length === 0) return 'Prix Fixe'
  return prices.length === 1 ? prices[0] : `${prices[0]}-${prices[prices.length - 1]}`
}

export default function DealsPanel({
  onSelect,
}: {
  onSelect: (r: Restaurant) => void
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
      <div className="flex flex-col gap-3 sm:mt-4 sm:py-3 text-base sm:text-lg leading-snug font-normal sm:font-semibold">
        <p className="font-semibold sm:hidden">Welcome to NYC Eats — World Cup Edition!</p>
        <p>
          In this sweltering and calamitious summer, 600+ restaurants offer <span className="text-pink-500">$30 to $60 </span> prix fixe experiences in NYC as part of Summer Restaurant Week.{' '}<br></br><br></br>
          <span className="sm:hidden">And I, Remy, help</span>
          <span className="hidden sm:inline">And Remy helps</span>
          {' '}you find the best deals — from <span className="text-pink-500">Michelin-starred</span> restaurants to <span className="text-pink-500">NY Times Top 100</span> picks. Toggle the filters on the map to find your dream spot.
        </p>
      </div>

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
    </div>
  )
}
