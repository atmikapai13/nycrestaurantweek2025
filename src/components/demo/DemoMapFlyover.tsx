import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import restaurantData from '../../data/FinalData.json';
import type { Restaurant } from '../../types/restaurant';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * DemoMapFlyover - Cinematic flyover of Manhattan from south to north
 *
 * Features:
 * - Pitch 65 for dramatic 3D effect
 * - Restaurant markers visible throughout
 * - No UI overlays (chat, filter bar)
 * - Smooth camera animation
 *
 * Access via /demo/flyover route
 */
export default function DemoMapFlyover() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize map at southern tip of Manhattan
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/atmikapai13/cmhdmnool00ai01qw6qz79zqu',
      center: [-74.013, 40.705], // Battery Park area (south Manhattan)
      zoom: 14.5,
      pitch: 75,
      bearing: 20, // Facing north
      antialias: true,
      customAttribution:
        '© <a href="https://www.linkedin.com/in/atmikapai/" target="_blank">Atmika Pai</a> © <a href="https://marauders.earth/" target="_blank">Marauders.Earth</a> © <a href="https://www.fultonring.com/" target="_blank">Fulton Ring</a> © <a href="https://urban.tech.cornell.edu/" target="_blank">Urban Tech Hub, Cornell Tech</a>',
    });

    map.current.on('load', () => {
      if (!map.current) return;

      // Add restaurant markers
      const restaurants = restaurantData as Restaurant[];

      restaurants.forEach((restaurant) => {
        if (!restaurant.latitude || !restaurant.longitude) return;

        // Determine marker color based on attributes
        const isFavorite = restaurant.name === 'Fish Cheeks'; // Default favorite
        const hasAward = restaurant.michelin_award || restaurant.nyttop100_rank;

        let markerColor = '#928f8e'; // Default grey
        if (isFavorite) {
          markerColor = '#ff67b2'; // Pink
        } else if (hasAward) {
          markerColor = '#c81224'; // Red
        }

        // Create marker element
        const markerEl = document.createElement('div');
        markerEl.style.width = '8px';
        markerEl.style.height = '8px';
        markerEl.style.borderRadius = '50%';
        markerEl.style.backgroundColor = markerColor;
        markerEl.style.border = '1px solid white';
        markerEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';

        new mapboxgl.Marker(markerEl)
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .addTo(map.current!);
      });

      // Start the flyover animation after a short delay
      setTimeout(() => {
        startFlyover();
      }, 1500);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  const startFlyover = () => {
    if (!map.current) return;

    // Fly from south Manhattan to north Manhattan
    // Battery Park → Midtown → Upper Manhattan
    map.current.flyTo({
      center: [-73.965, 40.800], // Upper West Side / Harlem border
      zoom: 14.5,
      pitch: 65,
      bearing: 0,
      duration: 25000, // 25 seconds for the full journey
      essential: true,
      easing: (t) => t, // Linear easing for smooth constant speed
    });
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
