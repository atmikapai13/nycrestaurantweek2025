"""
World Cup 2026 — Characteristics
================================
Enriches each restaurant from its offer page (https://www.nyctourism.com/offers/<slug>/)
with the few fields FBWS pages actually expose:
  - instagram_url
  - facebook_url
  - summary2       (the long description paragraph)
  - nytourism_url  (the offer page URL)

(RW's telephone/price_range/menu_url/week parsing are intentionally dropped —
FBWS pages don't carry them meaningfully.)

Input:  src/data/WorldCup2026/2_Geocoded.json
Output: src/data/WorldCup2026/3_Characteristics.json
"""

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "WorldCup2026")
INPUT = os.path.join(DATA_DIR, "2_Geocoded.json")
OUTPUT = os.path.join(DATA_DIR, "3_Characteristics.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Links to ignore when hunting for a restaurant's own social handle
SOCIAL_SKIP = ("nyctourism", "sharer", "share.php", "/share", "intent", "plugins/", "/dialog/")


class CharacteristicsExtractor:
    def __init__(self):
        self.request_delay = 0.15
        self.last_request_time = 0.0
        self.request_lock = threading.Lock()

    def _throttle(self):
        with self.request_lock:
            dt = time.time() - self.last_request_time
            if dt < self.request_delay:
                time.sleep(self.request_delay - dt)
            self.last_request_time = time.time()

    @staticmethod
    def _find_social(soup: BeautifulSoup, domain: str) -> Optional[str]:
        """Return the restaurant's own social URL for the given domain, skipping
        NYC Tourism's accounts and share/dialog links."""
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            low = href.lower()
            if domain not in low:
                continue
            if any(s in low for s in SOCIAL_SKIP):
                continue
            # Must point at an actual profile/handle, not just the bare domain
            after = low.split(domain, 1)[1].lstrip("/")
            if len(after) >= 2:
                return href
        return None

    @staticmethod
    def _clean_desc(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        # FBWS wraps the description in literal quotes — strip them
        if len(text) >= 2 and text[0] in "\"“" and text[-1] in "\"”":
            text = text[1:-1].strip()
        return text

    @staticmethod
    def _extract_description(soup: BeautifulSoup) -> Optional[str]:
        """The offer's long description (a div with class DetailPageInfo_descriptionParagraph)."""
        # Primary: the dedicated description block (a <div> on FBWS pages)
        el = soup.find(class_=re.compile(r"descriptionParagraph", re.I))
        if el:
            t = CharacteristicsExtractor._clean_desc(el.get_text(" ", strip=True))
            if t and len(t) > 20:
                return t
        # Secondary: any BodyText body block
        el = soup.find(class_=re.compile(r"BodyText_bodytext", re.I))
        if el:
            t = CharacteristicsExtractor._clean_desc(el.get_text(" ", strip=True))
            if t and len(t) > 20:
                return t
        # Fallback: longest non-address paragraph/div
        best = None
        for tag in soup.find_all(["p", "div"]):
            t = tag.get_text(" ", strip=True)
            if t and len(t) > 100 and not re.match(r"^\d+\s", t) and not t.startswith("("):
                if len(t) > len(best or ""):
                    best = t
        return CharacteristicsExtractor._clean_desc(best) if best else None

    def extract(self, item: Tuple[int, int, Dict]) -> Dict:
        idx, total, r = item
        out = dict(r)
        slug = r.get("slug", "")
        name = r.get("name", "Unknown")
        if not slug:
            print(f"[{idx}/{total}] ⚠️  {name}: no slug")
            return out

        url = f"https://www.nyctourism.com/offers/{slug}/"
        out["nytourism_url"] = url
        self._throttle()
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
        except Exception as e:
            print(f"[{idx}/{total}] ⚠️  {name}: {e}")
            return out
        if resp.status_code != 200:
            print(f"[{idx}/{total}] ⚠️  {name}: HTTP {resp.status_code}")
            return out

        soup = BeautifulSoup(resp.content, "html.parser")
        ig = self._find_social(soup, "instagram.com")
        fb = self._find_social(soup, "facebook.com")
        summary2 = self._extract_description(soup)
        if ig:
            out["instagram_url"] = ig
        if fb:
            out["facebook_url"] = fb
        if summary2:
            out["summary2"] = summary2

        found = [k for k in ("instagram_url", "facebook_url", "summary2") if out.get(k)]
        print(f"[{idx}/{total}] ✅ {name}: {found or 'none'}")
        return out

    def run(self, restaurants: List[Dict]) -> List[Dict]:
        print(f"🏢 Extracting characteristics for {len(restaurants)} restaurants...")
        items = [(i + 1, len(restaurants), r) for i, r in enumerate(restaurants)]
        results: List[Dict] = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            futures = {ex.submit(self.extract, it): it[2].get("slug") for it in items}
            for fut in as_completed(futures):
                try:
                    results.append(fut.result())
                except Exception as e:
                    print(f"❌ {futures[fut]}: {e}")
        order = {r["slug"]: i for i, r in enumerate(restaurants)}
        results.sort(key=lambda x: order.get(x.get("slug"), 1e9))
        return results


def main():
    with open(INPUT, encoding="utf-8") as f:
        restaurants = json.load(f)
    print(f"📂 Loaded {len(restaurants)} restaurants")

    enriched = CharacteristicsExtractor().run(restaurants)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(enriched, f, indent=2, ensure_ascii=False)
    print(f"💾 Saved → {OUTPUT}")

    n = len(enriched)
    for field in ("instagram_url", "facebook_url", "summary2", "nytourism_url"):
        c = sum(1 for r in enriched if r.get(field))
        print(f"   {field}: {c}/{n} ({c / n * 100:.1f}%)")


if __name__ == "__main__":
    main()
