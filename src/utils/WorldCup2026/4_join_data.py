"""
World Cup 2026 — Join Accolades
===============================
Left-joins Michelin (src/data/Lists/MichelinNYC.json) and NYT Top 100
(src/data/Lists/NYTTop100.json) onto the World Cup restaurants by name, and
fills any empty borough from the geocoded address.

Differences from the Restaurant Week join:
  - No 2025 merge (no prior World Cup dataset)
  - No Manhattan-only filter (World Cup spans all 5 boroughs)
  - Conservative name matching (exact + containment only) to avoid false badges

Input:  src/data/WorldCup2026/3_Characteristics.json
Output: src/data/WorldCup2026/4_JoinMichelin.json   (after Michelin)
        src/data/WorldCup2026/5_JoinNYT.json         (after NYT)
        src/data/WorldCup2026/worldcup2026.json       (final)
"""

import json
import os
import re
import unicodedata
from typing import Dict, List, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "WorldCup2026")
LISTS_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "Lists")

INPUT = os.path.join(DATA_DIR, "3_Characteristics.json")
MICHELIN_FILE = os.path.join(LISTS_DIR, "MichelinNYC.json")
NYT_FILE = os.path.join(LISTS_DIR, "NYTTop100.json")
OUT_MICHELIN = os.path.join(DATA_DIR, "4_JoinMichelin.json")
OUT_NYT = os.path.join(DATA_DIR, "5_JoinNYT.json")
OUT_FINAL = os.path.join(DATA_DIR, "worldcup2026.json")

_REPLACEMENTS = {
    "'": "", '"': "", "’": "", "“": "", "”": "", "&": "and",
    "-": " ", "_": " ", ".": "", ",": "", "!": "", "?": "",
    "(": "", ")": "", "[": "", "]": "", "restaurant": "rest", "restaurants": "rest",
}


def normalize(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    for old, new in _REPLACEMENTS.items():
        s = s.replace(old, new)
    return re.sub(r"\s+", " ", s).strip()


def find_match(name: str, refs: List[Dict]) -> Optional[Dict]:
    """Exact normalized-name match only.

    Containment matching was tried but produced false positives (e.g. the Hilton
    "Bridges Bar" matching Michelin/NYT "Bridges"). For accolades, precision beats
    recall — a missed badge is far better than a wrong one. Curate edge cases by
    hand or add slugs to the source lists if needed.
    """
    n = normalize(name)
    if not n:
        return None
    for r in refs:
        if normalize(r.get("name", "")) == n:
            return r
    return None


# ---- borough fill from address -------------------------------------------------
_BOROUGH_KEYWORDS = {
    "Brooklyn": ["brooklyn"],
    "Queens": ["queens", "astoria", "long island city", "flushing", "forest hills",
               "jackson heights", "elmhurst", "corona", "woodside", "sunnyside",
               "jamaica", "bayside", "ridgewood", "glendale", "middle village", "11101"],
    "The Bronx": ["bronx", "riverdale", "fordham", "belmont", "mott haven", "city island"],
    "Staten Island": ["staten island"],
    "Manhattan": ["manhattan", "new york, ny 100", "new york, ny 101", "new york, ny 102"],
}


def borough_from_address(address: str) -> Optional[str]:
    if not address:
        return None
    a = address.lower()
    # explicit borough names / neighborhoods first (skip Manhattan's loose zip match for now)
    for borough in ("Brooklyn", "Queens", "The Bronx", "Staten Island"):
        if any(k in a for k in _BOROUGH_KEYWORDS[borough]):
            return borough
    if any(k in a for k in _BOROUGH_KEYWORDS["Manhattan"]):
        return "Manhattan"
    return None


def load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(data, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"💾 Saved {len(data)} → {path}")


def main():
    restaurants = load(INPUT)
    michelin = load(MICHELIN_FILE)
    nyt_raw = load(NYT_FILE)
    nyt = nyt_raw["restaurants"] if isinstance(nyt_raw, dict) else nyt_raw
    print(f"📂 {len(restaurants)} restaurants | {len(michelin)} Michelin | {len(nyt)} NYT")

    # --- Michelin join ---
    m_matched = 0
    for r in restaurants:
        m = find_match(r.get("name", ""), michelin)
        r["michelin_award"] = m.get("michelin_award", "") if m else ""
        r["michelin_slug"] = m.get("slug", "") if m else ""
        r["michelin_url"] = m.get("michelin_url", "") if m else ""
        if m:
            m_matched += 1
            print(f"   🏅 {r['name']} ↔ {m.get('name')} ({m.get('michelin_award')})")
    save(restaurants, OUT_MICHELIN)

    # --- NYT join ---
    n_matched = 0
    for r in restaurants:
        m = find_match(r.get("name", ""), nyt)
        r["nyttop100_rank"] = m.get("rank", "") if m else ""
        r["nyt_url"] = m.get("nyt_url", "") if m else ""
        if m:
            n_matched += 1
            print(f"   📰 {r['name']} ↔ {m.get('name')} (#{m.get('rank')})")
    save(restaurants, OUT_NYT)

    # --- fill empty boroughs from address (don't override Algolia's) ---
    filled = 0
    for r in restaurants:
        if not r.get("borough"):
            b = borough_from_address(r.get("address", ""))
            if b:
                r["borough"] = b
                filled += 1
                print(f"   📍 filled borough: {r['name']} → {b}")
    save(restaurants, OUT_FINAL)

    # --- summary ---
    print("\n📊 Summary")
    print(f"   Michelin matched: {m_matched}/{len(restaurants)}")
    print(f"   NYT Top 100 matched: {n_matched}/{len(restaurants)}")
    print(f"   Boroughs filled from address: {filled}")
    still_unknown = sum(1 for r in restaurants if not r.get("borough"))
    print(f"   Still missing borough: {still_unknown}")
    by_b: Dict[str, int] = {}
    for r in restaurants:
        by_b[r.get("borough") or "Unknown"] = by_b.get(r.get("borough") or "Unknown", 0) + 1
    print("   By borough:", dict(sorted(by_b.items())))


if __name__ == "__main__":
    main()
