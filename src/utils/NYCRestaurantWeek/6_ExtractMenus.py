"""
Downloads each restaurant's Restaurant Week menu PDF (menu_url), extracts
text from the first few pages via pdfplumber, and uses Gemini to structure
it into courses/dishes. PDF layout varies restaurant to restaurant (course
labels, inline descriptions vs none, emoji-heavy vs plain), so a
fixed-template parser doesn't work — this has an LLM impose structure on
the raw text instead.

Some decoratively designed PDFs have no real text layer (text flattened
into background art); those come back with no extractable text and are
skipped (marked with error: "no_text_extracted") rather than falling back
to a vision-based read.

Output: src/data/dump/menus_all.json
"""

import os
import json
import time
import requests
import pdfplumber
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "NYCRestaurantWeek")
DUMP_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "dump")
PDF_CACHE_DIR = os.path.join(DUMP_DIR, "menu_pdfs")


def load_env():
    env_path = os.path.join(SCRIPT_DIR, "..", "..", "..", ".env")
    env = {}
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip('"')
    return env

ENV = load_env()
GOOGLE_API_KEY = ENV.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

MAX_PAGES = 3
MAX_WORKERS = 8

SCHEMA_PROMPT = """You are extracting a structured Restaurant Week prix fixe menu from raw PDF text.

The text may contain layout noise (repeated headers, stray characters from a two-up print layout, emoji). Ignore anything that isn't part of the actual menu (marketing taglines are fine to skip; restaurant name/logo text can be skipped).

Return ONLY valid JSON (no markdown fences, no commentary) matching this exact shape:

{
  "menus": [
    {
      "meal": "Dinner" | "Lunch" | "Lunch & Dinner" | "Brunch" | etc (whatever the PDF actually says),
      "price": "$30" | "$45" | "$60" | etc,
      "courses": {
        "<Course Name As Written>": [
          {"dish": "Dish Name", "description": "ingredients/description if present, else empty string"}
        ]
      }
    }
  ]
}

Rules:
- Preserve the PDF's own course names (e.g. "First Course", "Appetizer", "1st Course") rather than normalizing them.
- If a restaurant has separate Lunch and Dinner menus (different prices), include both as separate entries in "menus".
- If no description/ingredients are given for a dish, use "" — do not invent one.
- If the text is unreadable / not actually a menu / empty, return {"menus": []}.

Raw PDF text follows:
---
"""


def extract_pdf_text(pdf_bytes: bytes, max_pages: int = MAX_PAGES) -> str:
    """Extract text from the first N pages of a PDF."""
    text_parts = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:max_pages]:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text)
    return "\n\n---PAGE BREAK---\n\n".join(text_parts)


def call_gemini(raw_text: str, retries: int = 3) -> Optional[Dict]:
    """Call Gemini to structure raw menu text into JSON."""
    if not raw_text.strip():
        return {"menus": []}

    payload = {
        "contents": [{"parts": [{"text": SCHEMA_PROMPT + raw_text[:12000]}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }

    for attempt in range(retries):
        try:
            resp = requests.post(
                GEMINI_URL,
                params={"key": GOOGLE_API_KEY},
                json=payload,
                timeout=60,
            )
            if resp.status_code == 200:
                data = resp.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
            elif resp.status_code == 429:
                wait = (attempt + 1) * 5
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    Gemini error {resp.status_code}: {resp.text[:200]}")
                return None
        except Exception as e:
            print(f"    Gemini call failed (attempt {attempt+1}): {e}")
            time.sleep(2)
    return None


def process_restaurant(restaurant: Dict, index: int, total: int) -> Dict:
    slug = restaurant["slug"]
    name = restaurant["name"]
    menu_url = restaurant["menu_url"]

    print(f"[{index}/{total}] {name}")

    pdf_path = os.path.join(PDF_CACHE_DIR, f"{slug}.pdf")

    try:
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
        else:
            resp = requests.get(menu_url, timeout=30)
            if resp.status_code != 200:
                print(f"    ❌ Download failed: HTTP {resp.status_code}")
                return {"slug": slug, "name": name, "menus": [], "error": f"download_http_{resp.status_code}"}
            pdf_bytes = resp.content
            os.makedirs(PDF_CACHE_DIR, exist_ok=True)
            with open(pdf_path, "wb") as f:
                f.write(pdf_bytes)

        raw_text = extract_pdf_text(pdf_bytes)
        if not raw_text.strip():
            print(f"    ⚠️  No extractable text (likely a decorative/image-based PDF) — skipped")
            return {"slug": slug, "name": name, "menus": [], "error": "no_text_extracted"}

        result = call_gemini(raw_text)
        if result is None:
            return {"slug": slug, "name": name, "menus": [], "error": "gemini_failed"}

        menus = result.get("menus", [])
        print(f"    ✅ {len(menus)} menu(s) extracted")
        return {"slug": slug, "name": name, "menus": menus}

    except Exception as e:
        print(f"    ❌ Error: {e}")
        return {"slug": slug, "name": name, "menus": [], "error": str(e)}


def main():
    if not GOOGLE_API_KEY:
        print("❌ GOOGLE_API_KEY not found in .env")
        return

    with open(os.path.join(DATA_DIR, "nycrestaurantweek2026.json"), "r", encoding="utf-8") as f:
        restaurants = json.load(f)

    with_menu = [r for r in restaurants if r.get("menu_url") and r["menu_url"].strip()]
    print(f"📄 {len(with_menu)} restaurants have a menu_url\n")

    os.makedirs(DUMP_DIR, exist_ok=True)
    os.makedirs(PDF_CACHE_DIR, exist_ok=True)

    results = []
    total = len(with_menu)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_restaurant, r, i + 1, total): r
            for i, r in enumerate(with_menu)
        }
        for future in as_completed(futures):
            results.append(future.result())

            if len(results) % 25 == 0:
                slug_order = {r["slug"]: i for i, r in enumerate(with_menu)}
                results.sort(key=lambda r: slug_order.get(r["slug"], 0))
                with open(os.path.join(DUMP_DIR, "menus_all.json"), "w", encoding="utf-8") as f:
                    json.dump(results, f, indent=2, ensure_ascii=False)
                print(f"\n📊 Progress: {len(results)}/{total}\n")

    slug_order = {r["slug"]: i for i, r in enumerate(with_menu)}
    results.sort(key=lambda r: slug_order.get(r["slug"], 0))

    output_path = os.path.join(DUMP_DIR, "menus_all.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    success = sum(1 for r in results if r.get("menus"))
    errors = sum(1 for r in results if r.get("error"))
    print(f"\n🎉 Done! {success}/{total} restaurants with extracted menus, {errors} errors/skipped")
    print(f"💾 Saved to {output_path}")


if __name__ == "__main__":
    main()
