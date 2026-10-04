/**
 * Restaurant markers drawn as Mapbox layers (in the map's WebGL canvas), not DOM
 * markers: they render in one pass, sit in the map's 3D scene (perspective under
 * pitch), and restyle without rebuilding anything.
 *
 *   restaurants-hit             invisible, larger circles so small dots are easy to tap
 *   restaurants-dots            grey dots, pink for favorites; radius grows with zoom
 *   restaurants-picks           red teardrops numbered 1, 2, 3… for Remi's current picks (his order,
 *                               matching the numbers in his reply), a bit smaller, name beside each
 *   restaurants-selected        a dark ink teardrop, a little bigger, for the selected restaurant
 *                               (numbered if it's one of Remi's picks), matching its card
 *
 * Above them, `places-characters` draws the searched places' character portraits
 * (Alfredo, Collette…). Isochrones go beneath everything.
 *
 * Teardrop and portrait images are drawn once onto a canvas and registered with addImage.
 */
import type { LayerSpecification, Map as MapboxMap } from "mapbox-gl";
import type { Restaurant } from "../types/restaurant";
import { colors } from "@/styles/tokens";
import { displayName } from "../utils/restaurantName";

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
const SELECTED_PIN_SCALE = 0.75;

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

/** Teardrop with a white rim (red for Remi's picks, ink when selected), with his pick number in
    its round part (or plain). */
function drawPickPin(number?: number, fill: string = RED): ImageData {
  const { el, ctx } = canvas(PIN.W, PIN.H);
  drawPinShape(ctx, fill, { color: colors.white, width: 2 });
  if (number) {
    ctx.fillStyle = colors.white;
    ctx.font = `700 ${number > 9 ? 14 : 17}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), PIN.cx, PIN.cy + 1);
  }
  return ctx.getImageData(0, 0, el.width, el.height);
}

/** Numbered pins exist for picks 1…MAX_NUMBERED_PICK; later ones use the plain pin. */
const MAX_NUMBERED_PICK = 10;
const pickPinImage = (n: number) => `${PICK_PIN_IMAGE}-${n}`;
const SELECTED_PIN_IMAGE = "pin-selected";
const selectedPinImage = (n: number) => `${SELECTED_PIN_IMAGE}-${n}`;

function registerImages(map: MapboxMap) {
  for (let n = 1; n <= MAX_NUMBERED_PICK; n++) {
    if (!map.hasImage(pickPinImage(n))) map.addImage(pickPinImage(n), drawPickPin(n), { pixelRatio: PIXEL_RATIO });
    if (!map.hasImage(selectedPinImage(n)))
      map.addImage(selectedPinImage(n), drawPickPin(n, colors.ink), { pixelRatio: PIXEL_RATIO });
  }
  if (!map.hasImage(SELECTED_PIN_IMAGE))
    map.addImage(SELECTED_PIN_IMAGE, drawPickPin(undefined, colors.ink), { pixelRatio: PIXEL_RATIO });
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

  // The restaurant's name to the right of the pin's round head (Remi's picks only). Labels that
  // would collide are dropped (the pin stays), so crowded areas don't turn into a pile of text.
  const pickLabelLayout = {
    "text-field": ["get", "label"],
    "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    "text-size": 12,
    "text-anchor": "left",
    "text-offset": [1, -1.5],
    "text-max-width": 10,
    "text-optional": true,
  };
  const pickLabelPaint = {
    "text-color": colors.ink,
    "text-halo-color": colors.white,
    "text-halo-width": 1.5,
  };

  const teardropLayout = {
    // Numbered when it's one of Remi's picks, else the plain red pin
    "icon-image": [
      "case",
      ["all", [">", ["get", "pickNumber"], 0], ["<=", ["get", "pickNumber"], MAX_NUMBERED_PICK]],
      ["concat", `${PICK_PIN_IMAGE}-`, ["to-string", ["get", "pickNumber"]]],
      PICK_PIN_IMAGE,
    ],
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
      ...pickLabelLayout,
    },
    paint: pickLabelPaint,
  });

  addLayer(map, {
    id: LAYERS.selected,
    type: "symbol",
    source: RESTAURANT_SOURCE,
    filter: highlighted,
    layout: {
      ...teardropLayout,
      // Same pin in ink, numbered if it's one of Remi's picks
      "icon-image": [
        "case",
        ["all", [">", ["get", "pickNumber"], 0], ["<=", ["get", "pickNumber"], MAX_NUMBERED_PICK]],
        ["concat", `${SELECTED_PIN_IMAGE}-`, ["to-string", ["get", "pickNumber"]]],
        SELECTED_PIN_IMAGE,
      ],
      "icon-size": SELECTED_PIN_SCALE,
      // Keeps its name when selected (label is empty for restaurants that aren't Remi's picks)
      ...pickLabelLayout,
      "text-offset": [1.1, -1.7],
    },
    paint: pickLabelPaint,
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

/** GeoJSON for the restaurant source. Recommended = in Remi's latest answer (red pin numbered in
    his order, with its name); highlighted = selected. */
export function restaurantFeatures(
  restaurants: Restaurant[],
  options: { favorites: string[]; selectedSlug: string | null; recommended: string[] }
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const pickNumber = new Map(options.recommended.map((slug, i) => [slug, i + 1]));
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const r of restaurants) {
    if (!r.latitude || !r.longitude) continue;
    const favorite = options.favorites.includes(r.name);
    const selected = r.slug === options.selectedSlug;
    const recommended = pickNumber.has(r.slug);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      properties: {
        slug: r.slug,
        favorite,
        recommended,
        selected,
        highlight: selected,
        pickNumber: pickNumber.get(r.slug) ?? 0,
        label: recommended ? displayName(r.name) : "",
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
