/**
 * Restaurant markers drawn as Mapbox layers (in the map's WebGL canvas), not DOM
 * markers: they render in one pass, sit in the map's 3D scene (perspective under
 * pitch), and restyle without rebuilding anything.
 *
 *   restaurants-hit             invisible, larger circles so small dots are easy to tap
 *   restaurants-dots            grey dots, pink for favorites; radius grows with zoom
 *   restaurants-picks           plain red teardrops for Remi's current picks, a bit smaller
 *   restaurants-selected        the same red teardrop, a little bigger, for the selected restaurant
 *
 * Above them, `places-characters` draws the searched places' character portraits
 * (Alfredo, Collette…). Isochrones go beneath everything.
 *
 * Teardrop and portrait images are drawn once onto a canvas and registered with addImage.
 */
import type { LayerSpecification, Map as MapboxMap } from "mapbox-gl";
import type { Restaurant } from "../types/restaurant";
import { colors } from "@/styles/tokens";

export const RESTAURANT_SOURCE = "restaurants";
const LAYERS = {
  hit: "restaurants-hit",
  dots: "restaurants-dots",
  picks: "restaurants-picks",
  selected: "restaurants-selected",
};
export const CLICKABLE_RESTAURANT_LAYERS = [LAYERS.hit, LAYERS.picks, LAYERS.selected];
const PICK_PIN_IMAGE = "pin-pick";

export const PLACES_SOURCE = "places";
const PLACES_LAYER = "places-characters";
/** Layers drawn under the restaurants and place portraits (e.g. isochrones) are inserted before this one. */
export const FIRST_OVERLAY_LAYER = LAYERS.hit;

const GREY = colors.grey;
const PINK = colors.pinkLight;
const RED = colors.red;
const PIXEL_RATIO = 2;
/** Size of the selected restaurant's pin (picks grow from 0.6 to 0.7 with zoom) */
export const SELECTED_PIN_SCALE = 0.75;

function canvas(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = width * PIXEL_RATIO;
  el.height = height * PIXEL_RATIO;
  const ctx = el.getContext("2d")!;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  return { el, ctx };
}

// Teardrop geometry (the red pin for Remi's picks and the selected restaurant)
const PIN = { W: 44, H: 52, cx: 22, cy: 20, r: 15, tipY: 46 };

/** Teardrop outline with its point at the bottom center, filled and stroked with a soft shadow. */
function drawPinShape(ctx: CanvasRenderingContext2D, fill: string, rim: { color: string; width: number }) {
  const { cx, cy, r, tipY } = PIN;
  // Tangent points from the tip to the circle
  const spread = Math.acos(r / (tipY - cy));
  const right = Math.PI / 2 - spread;
  const left = Math.PI / 2 + spread;
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx + r * Math.cos(right), cy + r * Math.sin(right));
  ctx.arc(cx, cy, r, right, left, true);
  ctx.closePath();

  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = rim.width;
  ctx.strokeStyle = rim.color;
  ctx.stroke();
}

/** Plain red teardrop with a white rim: Remi's picks and the selected restaurant. */
function drawPickPin(): ImageData {
  const { el, ctx } = canvas(PIN.W, PIN.H);
  drawPinShape(ctx, RED, { color: colors.white, width: 2 });
  return ctx.getImageData(0, 0, el.width, el.height);
}

function registerImages(map: MapboxMap) {
  if (!map.hasImage(PICK_PIN_IMAGE)) map.addImage(PICK_PIN_IMAGE, drawPickPin(), { pixelRatio: PIXEL_RATIO });
}

// Style expressions are written as plain arrays; Mapbox's expression typings are too
// strict to express them directly, so specs go through this one cast.
const addLayer = (map: MapboxMap, spec: Record<string, unknown>) => map.addLayer(spec as unknown as LayerSpecification);

/** Add the place-portrait and restaurant sources and layers. Call once, after the style has loaded. */
export function addRestaurantLayers(map: MapboxMap, mobile: boolean) {
  registerImages(map);
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource(PLACES_SOURCE, { type: "geojson", data: empty });
  map.addSource(RESTAURANT_SOURCE, { type: "geojson", data: empty });

  const favorite = ["get", "favorite"];
  const recommended = ["get", "recommended"];
  const highlighted = ["get", "highlight"];
  // Remi's picks (unless selected, which gets the bigger pin) are drawn as red pins instead
  const pick = ["all", recommended, ["!", ["get", "selected"]]];
  // Dot diameter scales from minScale (zoom 10) to maxScale (zoom 16): base 10px, 12px for favorites
  const [minScale, maxScale] = mobile ? [0.45, 1.5] : [0.5, 1.2];
  const radiusAt = (scale: number) => ["case", favorite, (12 * scale) / 2, (10 * scale) / 2];
  // Drawn on top: selected > Remi's picks > favorites > the rest
  const sortKey = ["case", ["get", "selected"], 3, recommended, 2, favorite, 1, 0];

  const teardropLayout = {
    "icon-image": PICK_PIN_IMAGE,
    "icon-anchor": "bottom",
    "icon-offset": [0, 5], // the pin's point (not the shadow margin) touches the location
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "symbol-sort-key": sortKey,
  };

  addLayer(map, {
    id: LAYERS.hit,
    type: "circle",
    source: RESTAURANT_SOURCE,
    filter: ["!", ["any", highlighted, pick]],
    paint: { "circle-radius": mobile ? 14 : 11, "circle-opacity": 0 },
  });

  addLayer(map, {
    id: LAYERS.dots,
    type: "circle",
    source: RESTAURANT_SOURCE,
    filter: ["!", ["any", highlighted, pick]],
    layout: { "circle-sort-key": sortKey },
    paint: {
      "circle-color": ["case", favorite, PINK, GREY],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, radiusAt(minScale), 16, radiusAt(maxScale)],
      "circle-stroke-color": colors.white,
      "circle-stroke-width": 1,
      // Face the camera so dots stay round under the map's 45° pitch (perspective still
      // makes distant ones smaller); "map" would lay them flat and squash them into ovals.
      "circle-pitch-alignment": "viewport",
    },
  });

  addLayer(map, {
    id: LAYERS.picks,
    type: "symbol",
    source: RESTAURANT_SOURCE,
    filter: pick,
    layout: {
      ...teardropLayout,
      // A bit smaller than the selected restaurant's teardrop, growing with zoom
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 0.7],
    },
  });

  addLayer(map, {
    id: LAYERS.selected,
    type: "symbol",
    source: RESTAURANT_SOURCE,
    filter: highlighted,
    // Fixed size (the card popup lines up with its top; see MapRestaurantPopup.tsx)
    layout: { ...teardropLayout, "icon-size": SELECTED_PIN_SCALE },
  });

  // Added last, so the place portraits draw above every restaurant marker
  addLayer(map, {
    id: PLACES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

/** GeoJSON for the restaurant source. Recommended = in Remi's latest answer (red pin); highlighted = selected. */
export function restaurantFeatures(
  restaurants: Restaurant[],
  options: { favorites: string[]; selectedSlug: string | null; recommended: Set<string> }
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const r of restaurants) {
    if (!r.latitude || !r.longitude) continue;
    const favorite = options.favorites.includes(r.name);
    const selected = r.slug === options.selectedSlug;
    const recommended = options.recommended.has(r.slug);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      properties: {
        slug: r.slug,
        favorite,
        recommended,
        selected,
        highlight: selected,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// ============ Place portraits (searched locations) ============

const portraitImageId = (url: string) => `portrait-${url}`;
const portraitLoads = new Map<string, Promise<void>>();

/** Circular 40px portrait with a white backing and pink rim. */
function registerPortrait(map: MapboxMap, url: string): Promise<void> {
  const id = portraitImageId(url);
  if (map.hasImage(id)) return Promise.resolve();
  if (!portraitLoads.has(id)) {
    portraitLoads.set(
      id,
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const SIZE = 46; // 40px portrait + room for the shadow
          const r = 20;
          const c = SIZE / 2;
          const { el, ctx } = canvas(SIZE, SIZE);
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;
          ctx.beginPath();
          ctx.arc(c, c, r, 0, Math.PI * 2);
          ctx.fillStyle = colors.white;
          ctx.fill();
          ctx.restore();
          // Cover-fit the portrait inside the circle
          ctx.save();
          ctx.beginPath();
          ctx.arc(c, c, r - 1.5, 0, Math.PI * 2);
          ctx.clip();
          const scale = Math.max((2 * r) / img.width, (2 * r) / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, c - w / 2, c - h / 2, w, h);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(c, c, r - 1.5, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = PINK;
          ctx.stroke();
          if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, el.width, el.height), { pixelRatio: PIXEL_RATIO });
          resolve();
        };
        img.onerror = () => reject(new Error(`Could not load ${url}`));
        img.src = url;
      })
    );
  }
  return portraitLoads.get(id)!;
}

/** Show the searched places' character portraits (loads each portrait image once). */
export async function setPlaces(
  map: MapboxMap,
  places: Array<{ latitude: number; longitude: number; characterImage: string }>
): Promise<void> {
  await Promise.all(places.map((p) => registerPortrait(map, p.characterImage).catch(() => undefined)));
  const source = map.getSource(PLACES_SOURCE) as { setData?: (data: unknown) => void } | undefined;
  source?.setData?.({
    type: "FeatureCollection",
    features: places
      .filter((p) => map.hasImage(portraitImageId(p.characterImage)))
      .map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: { icon: portraitImageId(p.characterImage) },
      })),
  });
}
