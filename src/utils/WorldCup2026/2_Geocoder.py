"""
World Cup 2026 — Geocoder
=========================
The FBWS Algolia records have no coordinates, but each offer's detail page
(https://www.nyctourism.com/offers/<slug>/) embeds both:
  - coordinates in a Google Maps link:  .../maps/dir/Current+Location/<lat>,<lng>
  - the street address in an adjacent <div>

Primary strategy: fetch the offer page and regex out the coords + address.
Fallback: if a page yields no coords, geocode the address (or name+neighborhood)
via Geoapify (GEOAPIFY_API_KEY env var).

Input:  src/data/WorldCup2026/1_Scraped.json
Output: src/data/WorldCup2026/2_Geocoded.json
"""

import json
import os
import re
import threading
import time
import urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "WorldCup2026")
INPUT = os.path.join(DATA_DIR, "1_Scraped.json")
OUTPUT = os.path.join(DATA_DIR, "2_Geocoded.json")

GEOAPIFY_API_KEY = os.environ.get("GEOAPIFY_API_KEY", "")

# Coordinates embedded in the Maps directions link on the offer page
COORDS_RE = re.compile(r"maps/dir/[^/\"]*/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)")
# The address div sits right after that link; grab the first <div> text following it
ADDR_AFTER_LINK_RE = re.compile(
    r"maps/dir/[^\"]*\"[^>]*>.*?<div[^>]*>([^<]{6,120})</div>", re.DOTALL
)
# Generic NYC address fallback (street ... , <City/Borough>, NY <zip>)
ADDR_GENERIC_RE = re.compile(
    r"(\d{1,5}[^<>]{3,60},\s*[A-Za-z .]+,\s*NY\s*\d{5})"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class Geocoder:
    def __init__(self):
        self.request_delay = 0.1
        self.last_request_time = 0.0
        self.request_lock = threading.Lock()

    def _throttle(self):
        with self.request_lock:
            dt = time.time() - self.last_request_time
            if dt < self.request_delay:
                time.sleep(self.request_delay - dt)
            self.last_request_time = time.time()

    def extract_from_page(self, slug: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
        """Fetch the offer page and pull (lat, lng, address)."""
        url = f"https://www.nyctourism.com/offers/{slug}/"
        self._throttle()
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
        except Exception as e:
            print(f"      ⚠️  fetch error for {slug}: {e}")
            return None, None, None
        if resp.status_code != 200:
            print(f"      ⚠️  HTTP {resp.status_code} for {slug}")
            return None, None, None

        html = resp.text
        lat = lng = None
        m = COORDS_RE.search(html)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))

        address = None
        am = ADDR_AFTER_LINK_RE.search(html)
        if am:
            address = re.sub(r"\s+", " ", am.group(1)).strip()
        if not address:
            am2 = ADDR_GENERIC_RE.search(html)
            if am2:
                address = re.sub(r"\s+", " ", am2.group(1)).strip()

        return lat, lng, address

    def geocode_geoapify(self, query: str) -> Optional[Tuple[float, float, str]]:
        """Fallback geocode via Geoapify, biased to NYC."""
        if not GEOAPIFY_API_KEY:
            return None
        try:
            params = {
                "text": query,
                "apiKey": GEOAPIFY_API_KEY,
                "limit": 1,
                "filter": "rect:-74.2591,40.4774,-73.7004,40.9176",  # NYC bbox
                "bias": "proximity:-73.9712,40.7831",
            }
            url = "https://api.geoapify.com/v1/geocode/search?" + urllib.parse.urlencode(params)
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                feats = resp.json().get("features", [])
                if feats:
                    props = feats[0]["properties"]
                    return props["lat"], props["lon"], props.get("formatted", query)
        except Exception as e:
            print(f"      ⚠️  geoapify error: {e}")
        return None

    def process(self, item: Tuple[int, int, Dict]) -> Dict:
        idx, total, r = item
        name = r.get("name", "Unknown")
        slug = r.get("slug", "")
        out = dict(r)
        out["address"] = None
        out["latitude"] = None
        out["longitude"] = None
        out["geocode_method"] = None

        lat, lng, address = (None, None, None)
        if slug:
            lat, lng, address = self.extract_from_page(slug)

        if lat is not None and lng is not None:
            out.update(address=address, latitude=lat, longitude=lng, geocode_method="offer_page")
        else:
            # Fallback: geocode address from page, else name + neighborhood + borough
            query = address or ", ".join(
                p for p in [name, r.get("neighborhood"), r.get("borough"), "New York, NY"] if p
            )
            g = self.geocode_geoapify(query)
            if g:
                glat, glng, gaddr = g
                out.update(
                    address=address or gaddr,
                    latitude=glat,
                    longitude=glng,
                    geocode_method="geoapify",
                )

        status = "✅" if out["latitude"] is not None else "❌"
        print(f"[{idx}/{total}] {status} {name} ({out['geocode_method']})")
        return out

    def run(self, restaurants: List[Dict]) -> List[Dict]:
        print(f"📍 Geocoding {len(restaurants)} restaurants from offer pages...")
        items = [(i + 1, len(restaurants), r) for i, r in enumerate(restaurants)]
        results: List[Dict] = []
        with ThreadPoolExecutor(max_workers=10) as ex:
            futures = {ex.submit(self.process, it): it[2].get("slug") for it in items}
            for fut in as_completed(futures):
                try:
                    results.append(fut.result())
                except Exception as e:
                    print(f"❌ {futures[fut]}: {e}")
        # restore original order by slug
        order = {r["slug"]: i for i, r in enumerate(restaurants)}
        results.sort(key=lambda x: order.get(x.get("slug"), 1e9))
        return results

    @staticmethod
    def apply_offsets(restaurants: List[Dict]) -> List[Dict]:
        """Nudge restaurants sharing exact coords so markers don't stack."""
        coords = defaultdict(list)
        for i, r in enumerate(restaurants):
            if r.get("latitude") and r.get("longitude"):
                coords[(round(float(r["latitude"]), 6), round(float(r["longitude"]), 6))].append(i)
        offsets = [
            (0, 0), (0.00012, 0), (-0.00012, 0), (0, 0.00012), (0, -0.00012),
            (0.00009, 0.00009), (-0.00009, 0.00009), (0.00009, -0.00009), (-0.00009, -0.00009),
        ]
        adjusted = 0
        for _, idxs in coords.items():
            if len(idxs) > 1:
                for i, idx in enumerate(idxs):
                    dlat, dlng = offsets[i % len(offsets)]
                    if i:
                        restaurants[idx]["latitude"] = float(restaurants[idx]["latitude"]) + dlat
                        restaurants[idx]["longitude"] = float(restaurants[idx]["longitude"]) + dlng
                        adjusted += 1
        print(f"✅ De-stacked {adjusted} overlapping markers")
        return restaurants


def main():
    with open(INPUT, encoding="utf-8") as f:
        restaurants = json.load(f)
    print(f"📂 Loaded {len(restaurants)} restaurants")

    gc = Geocoder()
    if not GEOAPIFY_API_KEY:
        print("⚠️  GEOAPIFY_API_KEY not set — fallback geocoding disabled (page extraction only)")

    geocoded = gc.apply_offsets(gc.run(restaurants))

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(geocoded, f, indent=2, ensure_ascii=False)
    print(f"💾 Saved → {OUTPUT}")

    ok = sum(1 for r in geocoded if r.get("latitude") is not None)
    methods = defaultdict(int)
    for r in geocoded:
        if r.get("latitude") is not None:
            methods[r.get("geocode_method")] += 1
    print(f"\n📊 Geocoded {ok}/{len(geocoded)}  ({len(geocoded) - ok} failed)")
    for m, c in methods.items():
        print(f"   {m}: {c}")
    addr = sum(1 for r in geocoded if r.get("address"))
    print(f"   with address: {addr}")


if __name__ == "__main__":
    main()
