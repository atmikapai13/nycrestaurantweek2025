"""
Derives menu-content filter tags (raw_bar, drinks_tag) from the extracted
menu data and writes them onto the matching records in
src/data/NYCRestaurantWeek/nycrestaurantweek2026.json (matched by slug) —
the file MapContext.tsx actually loads restaurant data from.

raw_bar comes from src/data/dump/menus_all.json (the Gemini-structured
dish/course extraction). Only restaurants with a successfully extracted
menu get a raw_bar value (True/False); restaurants with no extracted menu
are left untouched since there's no evidence either way.

drinks_tag ("wine_pairing" | "included") is NOT derivable from
menus_all.json — the Gemini extraction schema only captures dishes/courses
and was explicitly told to drop marketing/non-dish text, which is exactly
where drink pairing notes live (e.g. "Optional Wine Pairing $35" printed
as a footer, not a course). These two lists were manually curated by
reading the raw PDF text (src/data/dump/menu_pdfs/) directly, distinguishing
a genuine paid add-on ("Wine Pairing +$18", "recommended drink add-ons")
from a drink actually bundled into the prix fixe price ("complimentary
signature cocktail", a "To Drink" course offered as one of the built-in
choices). Restaurants with an ambiguous mention (e.g. what reads like a
regular-menu wine-list note rather than a Restaurant Week menu callout)
were left untagged rather than guessed.

course_counts (["2"|"3"|"4+", ...]) and bonus_course (bool) come from the
structured course dict per menu entry in menus_all.json. A menu's "base"
course count excludes groups that read as a free extra (bread, amuse-bouche,
a complimentary starter like Momofuku's "Pickle Plate") or an optional paid
upcharge (a course name ending in "+$8" etc) — those get flagged as
bonus_course=True instead of inflating the count. Cross-checked against the
restaurant's own literal "N-Course" claim in the raw PDF text where present
(e.g. The Parliament says "3-course" but has 4 structured groups because of
a free amuse-bouche; Bar Primi says "2-course" but has 3 because dessert is
a "+$8" add-on) — both of those are core_count=matches-claim, bonus=True,
not a bumped-up course count.

Run after 6_ExtractMenus.py has produced src/data/dump/menus_all.json.
"""

import json
import os
import re

import pdfplumber

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DUMP_DIR = os.path.join(SCRIPT_DIR, "..", "..", "data", "dump")
DUMP_PATH = os.path.join(DUMP_DIR, "menus_all.json")
PDF_CACHE_DIR = os.path.join(DUMP_DIR, "menu_pdfs")
FINAL_DATA_PATH = os.path.join(
    SCRIPT_DIR, "..", "..", "data", "NYCRestaurantWeek", "nycrestaurantweek2026.json"
)

# Course-group names that signal a free extra rather than a selectable course.
BONUS_GROUP_KEYWORDS = re.compile(
    r"\b(bread|amuse|welcome|complimentary|pickle plate)\b", re.IGNORECASE
)
# Course-group names carrying their own upcharge (e.g. "Choice of Dolci + $8").
ADDON_GROUP_PATTERN = re.compile(r"\+\s*\$|\+\s*\d+\s*(supplement|extra)?\s*$", re.IGNORECASE)

# The restaurant's own literal "N-Course" claim, read from raw PDF text —
# used only as a bonus_course cross-check, not to set course_counts itself
# (the per-entry structured count is more granular: a restaurant can offer
# 2-course lunch and 3-course dinner in the same PDF).
LITERAL_COURSE_CLAIM = re.compile(r"(\d)\s*[-–]?\s*course", re.IGNORECASE)


def extract_literal_course_claims(slug: str) -> set:
    path = os.path.join(PDF_CACHE_DIR, f"{slug}.pdf")
    if not os.path.exists(path):
        return set()
    try:
        with pdfplumber.open(path) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages[:3])
    except Exception:
        return set()
    return {int(m.group(1)) for m in LITERAL_COURSE_CLAIM.finditer(text) if 1 <= int(m.group(1)) <= 6}


def bucket_course_count(n: int) -> str:
    if n <= 2:
        return "2"
    if n == 3:
        return "3"
    return "4+"

# Dishes/ingredients that signal a raw bar offering.
RAW_BAR_KEYWORDS = ["oyster", "crudo", "tartare", "caviar", "ceviche", "raw bar"]

# Manually reviewed (see module docstring) — paid wine/cocktail pairing add-on,
# including flat "wine by the bottle/glass" lists printed on the RW menu itself
# (e.g. Empire Steak House's "MANAGER-SELECTED WINES | $59.95 by the bottle"),
# which read the same as a pairing: an optional priced drink alongside the meal.
WINE_PAIRING_SLUGS = [
    "bar-mercer", "cantina-138", "chazz-palminteri-italian-restaurant",
    "empire-steak-house-east-50th-street", "empire-steak-house-west-54th-street",
    "file-gumbo-bar", "grand-brasserie", "hangawi", "harta",
    "hawksmoor", "hearth", "hutong", "lalyn", "le-gratin", "le-rock",
    "little-alley", "little-maven", "lore", "lure-fishbar", "oceana",
    "pera-soho", "pinky-swear", "poppy", "san-carlo-osteria-piemonte",
    "sant-ambroeus-brookfield", "smyth-tavern", "society-cafe", "stella-34-trattoria",
    "takumen", "taste-of-india-ii", "tha-phraya", "the-dolar-shop-hot-pot",
    "the-flatiron-room-murray-hill", "the-flatiron-room", "the-terrace-and-outdoor-gardens",
    "vin-sur-vingt-e-51st-st", "wagamama-midtown", "wagamama-murray-hill", "wagamama",
    "zaytinya",
]

# Manually reviewed — a drink is bundled into the prix fixe price, not an upsell.
DRINK_INCLUDED_SLUGS = [
    "mito-forest-hills", "mito-fort-greene", "jade-eatery-and-lounge",
    "pera-mediterranean-brasserie",
]

# Manually reviewed — a standing discount off drinks bought separately from
# the prix fixe (not a paired add-on, not bundled into the set price).
DRINK_DISCOUNT_SLUGS = [
    "momofuku-noodle-bar-east-village", "momofuku-noodle-bar-uptown",
]


def restaurant_menu_text(record: dict) -> str:
    parts = []
    for menu in record.get("menus", []):
        for course, dishes in menu.get("courses", {}).items():
            parts.append(course)
            for dish in dishes:
                parts.append(dish.get("dish", ""))
                parts.append(dish.get("description", ""))
    return " ".join(parts).lower()


def course_info_for_record(record: dict) -> tuple:
    """Returns (course_counts set of '2'/'3'/'4+', bonus_course bool) for one restaurant."""
    course_counts = set()
    bonus_course = False

    literal_claims = extract_literal_course_claims(record["slug"])

    for menu in record.get("menus", []):
        all_keys = list(menu.get("courses", {}).keys())
        if not all_keys:
            continue
        core_keys = [
            k for k in all_keys
            if not BONUS_GROUP_KEYWORDS.search(k) and not ADDON_GROUP_PATTERN.search(k)
        ]
        core_count = len(core_keys) if core_keys else len(all_keys)
        course_counts.add(bucket_course_count(core_count))

        if len(core_keys) < len(all_keys):
            bonus_course = True
        # Safety net: restaurant's own claim is lower than the total structured
        # groups (catches bonus items our keyword/pattern lists didn't).
        if literal_claims and min(literal_claims) < len(all_keys):
            bonus_course = True

    return course_counts, bonus_course


def main():
    with open(DUMP_PATH, "r", encoding="utf-8") as f:
        menu_records = json.load(f)

    raw_bar_by_slug = {}
    course_info_by_slug = {}
    for record in menu_records:
        if not record.get("menus"):
            continue
        text = restaurant_menu_text(record)
        raw_bar_by_slug[record["slug"]] = any(kw in text for kw in RAW_BAR_KEYWORDS)
        course_info_by_slug[record["slug"]] = course_info_for_record(record)

    with open(FINAL_DATA_PATH, "r", encoding="utf-8") as f:
        restaurants = json.load(f)

    tagged = 0
    drinks_tagged = 0
    course_tagged = 0
    bonus_count = 0
    for r in restaurants:
        if r["slug"] in raw_bar_by_slug:
            r["raw_bar"] = raw_bar_by_slug[r["slug"]]
            tagged += 1
        if r["slug"] in WINE_PAIRING_SLUGS:
            r["drinks_tag"] = "wine_pairing"
            drinks_tagged += 1
        elif r["slug"] in DRINK_INCLUDED_SLUGS:
            r["drinks_tag"] = "included"
            drinks_tagged += 1
        elif r["slug"] in DRINK_DISCOUNT_SLUGS:
            r["drinks_tag"] = "discount"
            drinks_tagged += 1
        if r["slug"] in course_info_by_slug:
            counts, bonus = course_info_by_slug[r["slug"]]
            if counts:
                r["course_counts"] = sorted(counts)
                r["bonus_course"] = bonus
                course_tagged += 1
                if bonus:
                    bonus_count += 1

    with open(FINAL_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(restaurants, f, indent=2, ensure_ascii=False)

    raw_bar_true = sum(1 for v in raw_bar_by_slug.values() if v)
    print(f"Tagged {tagged} restaurants with raw_bar (True/False); {raw_bar_true} are raw_bar=True")
    print(f"Tagged {drinks_tagged} restaurants with drinks_tag "
          f"({len(WINE_PAIRING_SLUGS)} wine_pairing, {len(DRINK_INCLUDED_SLUGS)} included, "
          f"{len(DRINK_DISCOUNT_SLUGS)} discount)")
    print(f"Tagged {course_tagged} restaurants with course_counts; {bonus_count} have bonus_course=True")


if __name__ == "__main__":
    main()
