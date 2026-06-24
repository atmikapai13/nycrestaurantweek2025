"""
World Cup 2026 — Five Borough Winners Special (FBWS) Scraper
============================================================
NYC Tourism's FBWS program (https://www.nyctourism.com/five-borough-winners-special)
is powered by an Algolia index, not the program-api used by Restaurant Week.
Participating offers carry `isFBWS: true`, so we query that index directly.

Algolia search credentials below are the site's PUBLIC client-side search key
(same ones the website ships to the browser) — read-only, safe to embed.

Output (in src/data/WorldCup2026/):
  1_ScrapedRaw.json  - full raw Algolia hits
  1_Scraped.json     - cleaned, normalized records for the rest of the pipeline
"""

import json
import os
from typing import Any, Dict, List

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "WorldCup2026")

# Public Algolia search credentials (client-side, read-only)
ALGOLIA_APP_ID = "V9AISQOJEB"
ALGOLIA_API_KEY = "35756659d21eeb59facb8d4535a165cd"
ALGOLIA_INDEX = "prod_nyctourism_v3-en-US"
ALGOLIA_URL = (
    f"https://{ALGOLIA_APP_ID.lower()}-dsn.algolia.net/1/indexes/*/queries"
    f"?x-algolia-api-key={ALGOLIA_API_KEY}"
    f"&x-algolia-application-id={ALGOLIA_APP_ID}"
)

# Scopes the query to Five Borough Winners Special participants only
FBWS_FILTER = "isFBWS:true"
HITS_PER_PAGE = 1000  # Algolia's max page size (also its default paginationLimitedTo)


class FBWSScraper:
    def __init__(self):
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://www.nyctourism.com",
            "Referer": "https://www.nyctourism.com/five-borough-winners-special",
        }

    def _query(self, page: int, hits_per_page: int) -> Dict[str, Any]:
        """Run a single Algolia query for one page of FBWS hits."""
        body = {
            "requests": [
                {
                    "indexName": ALGOLIA_INDEX,
                    "params": (
                        f"filters={FBWS_FILTER}"
                        f"&hitsPerPage={hits_per_page}"
                        f"&page={page}"
                    ),
                }
            ]
        }
        resp = requests.post(ALGOLIA_URL, headers=self.headers, json=body, timeout=20)
        resp.raise_for_status()
        return resp.json()["results"][0]

    def get_all(self) -> List[Dict[str, Any]]:
        """Fetch every FBWS hit, paginating if there are more than one page."""
        print("🚀 Querying Algolia for Five Borough Winners Special offers...")
        first = self._query(page=0, hits_per_page=HITS_PER_PAGE)
        total = first.get("nbHits", 0)
        n_pages = first.get("nbPages", 1)
        hits = list(first.get("hits", []))
        print(f"   nbHits={total}  nbPages={n_pages}  (got {len(hits)} on page 0)")

        if total > HITS_PER_PAGE:
            # Algolia caps pagination at paginationLimitedTo (1000 by default).
            # If FBWS ever exceeds that, this would need facet-splitting (e.g. by borough).
            print(
                f"⚠️  {total} hits exceeds the {HITS_PER_PAGE} page cap — "
                "pagination may be truncated. Consider splitting by borough facet."
            )

        for page in range(1, n_pages):
            page_data = self._query(page=page, hits_per_page=HITS_PER_PAGE)
            page_hits = page_data.get("hits", [])
            hits.extend(page_hits)
            print(f"   page {page}: +{len(page_hits)} (running total {len(hits)})")

        print(f"🎉 Collected {len(hits)} FBWS offers")
        return hits

    @staticmethod
    def clean(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize raw Algolia hits into pipeline-friendly records."""
        cleaned: List[Dict[str, Any]] = []
        for h in hits:
            url = h.get("url", "")  # e.g. "/offers/fbws-inday-flatiron"
            slug = url.rsplit("/", 1)[-1] if url else ""
            promotions = h.get("Lookup - Promotion", []) or []
            neighborhoods = h.get("Lookup - Neighborhoods", []) or []
            cuisines = h.get("Lookup - Cuisine", []) or []
            boroughs = h.get("Lookup - Borough", []) or []
            image = h.get("image", {}) or {}

            cleaned.append(
                {
                    "name": (h.get("venueName") or "").strip(),
                    "slug": slug,  # e.g. "fbws-inday-flatiron"
                    "offer_url": f"https://www.nyctourism.com{url}" if url else "",
                    "summary": h.get("summary", ""),
                    "website": h.get("website") or "",
                    "borough": boroughs[0] if boroughs else "",
                    "neighborhood": neighborhoods[0] if neighborhoods else h.get("primaryLocation", ""),
                    "neighborhoods": neighborhoods,
                    "cuisine": cuisines[0] if cuisines else "",
                    "cuisines": cuisines,
                    "promotions": promotions,
                    "limited_edition_cup": "Limited Edition Cup" in promotions,
                    "has_26_offer": "$26 Offers" in promotions,
                    "taxonomy": h.get("Lookup - Taxonomy", []),
                    "image_url": image.get("url", ""),
                    "image_alt": image.get("alt", ""),
                    "image_credit": image.get("credit", ""),
                    "start_date": h.get("startDate"),
                    "end_date": h.get("endDate"),
                    "object_id": h.get("objectID", ""),
                }
            )
        return cleaned

    @staticmethod
    def dedupe(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Collapse duplicate offers for the same venue (same slug).

        The Algolia index sometimes has two FBWS entries for one restaurant
        (e.g. separate "$26 Offers" and "Limited Edition Cup" offers). Merge them
        into one record, unioning promotions and backfilling any empty fields.
        """
        by_slug: Dict[str, Dict[str, Any]] = {}
        for r in records:
            slug = r["slug"]
            if slug not in by_slug:
                by_slug[slug] = dict(r)
                continue
            base = by_slug[slug]
            promos = list(dict.fromkeys((base.get("promotions") or []) + (r.get("promotions") or [])))
            base["promotions"] = promos
            base["limited_edition_cup"] = "Limited Edition Cup" in promos
            base["has_26_offer"] = "$26 Offers" in promos
            for key, val in r.items():
                if not base.get(key) and val:
                    base[key] = val
        merged = len(records) - len(by_slug)
        if merged:
            print(f"🧹 Merged {merged} duplicate offer(s) by slug → {len(by_slug)} unique venues")
        return list(by_slug.values())

    @staticmethod
    def save(data: List[Dict[str, Any]], filename: str):
        path = os.path.join(DATA_DIR, filename)
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved {len(data)} records → {path}")


def main():
    scraper = FBWSScraper()
    raw = scraper.get_all()
    if not raw:
        print("❌ No FBWS offers returned")
        return

    cleaned = scraper.dedupe(scraper.clean(raw))
    scraper.save(raw, "1_ScrapedRaw.json")
    scraper.save(cleaned, "1_Scraped.json")

    # Summary by borough
    by_borough: Dict[str, int] = {}
    for r in cleaned:
        b = r.get("borough") or "Unknown"
        by_borough[b] = by_borough.get(b, 0) + 1
    print("\n📍 By Borough:")
    for b, c in sorted(by_borough.items()):
        print(f"   {b}: {c}")

    # Promotion breakdown
    cup = sum(1 for r in cleaned if r["limited_edition_cup"])
    offer26 = sum(1 for r in cleaned if r["has_26_offer"])
    missing_name = sum(1 for r in cleaned if not r["name"])
    print(f"\n🏆 Limited Edition Cup: {cup}   💵 $26 Offers: {offer26}")
    if missing_name:
        print(f"⚠️  {missing_name} records missing a venueName")


if __name__ == "__main__":
    main()
