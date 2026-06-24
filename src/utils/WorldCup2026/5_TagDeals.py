#!/usr/bin/env python3
"""
Tag World Cup 2026 venues with high-level DEAL CATEGORIES for the filter UI.

These tags are derived from the free-text deal descriptions (`summary` + `summary2`)
plus cuisine/taxonomy signals -- the goal is to make the *deals* discoverable, not the
cuisine. Each venue gets a `deal_tags` array (any subset of the tags below).

Toggle set (validated against TF-IDF + k-means clusters of the $26 offers):
    -- "$26 Offer" dropdown options (mutually-exclusive deal types; ORed in UI) --
    meal_drink_combo  -> "Meal + Drink" (food + a drink for $26 -- money goes farther)
    food_only         -> "Meal"         (a substantial food deal for $26, no drink)
    drink_only        -> "Drinks only"  (just a drink for $26 -- e.g. "$26 cocktail")
    desserts          -> "Dessert"       (doughnuts, ice cream, bakeries, pastries)
    -- attribute pills (orthogonal; intersect with the dropdown) --
    specialty_cocktails -> "Specialty Cocktails" (any cocktail mention -- margarita, martini, etc.)
    grab_n_go         -> "Grab-n-Go"
    burger_beer       -> "Burger & Beer"
    bars              -> "Bars"        (drinks-first venue type)
    watch_game        -> "Watch the Game" (explicitly shows the matches on screen)

Run:  python3 src/utils/WorldCup2026/5_TagDeals.py
Writes deal_tags back into src/data/WorldCup2026/worldcup2026.json (idempotent).
"""
import json, os, re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "data", "WorldCup2026", "worldcup2026.json"))


def text(r):
    return ((r.get("summary") or "") + " " + (r.get("summary2") or "") + " " + (r.get("name") or "")).lower()


def cuisines(r):
    return r.get("cuisines") or []


def taxonomy(r):
    return r.get("taxonomy") or []


DRINK_WORDS = [
    "beer", "draft", "draught", "pint", "lager", "ipa", "pitcher", "wine", "glass of",
    "cocktail", "margarita", "martini", "spritz", "negroni", "sangria", "mimosa",
    "tequila", "mezcal", "sake", "soju", "shot", "drink", "agua fresca", "spirits",
    "bottle of", "pina colada", "aperitivo", "beverage", "shandy", "mocktail", "lemonade",
    "slushie", "soft drink", "soda", "chicha", "pisco", "pilsner", "ale", "stout",
    # common brand beers that stand in for "beer" in the deal text
    "stella", "peroni", "miller", "michelob", "heineken", "corona", "modelo", "guinness",
    "bitburger", "birra", "bud light", "budweiser",
]
FOOD_WORDS = [
    "meal", "entree", "entrée", "main", "course", "burger", "pizza", "pasta", "sandwich",
    "taco", "wing", "plate", "platter", "appetizer", "oyster", "slider", "dish", "ramen",
    "rice", "gyro", "pita", "empanada", "flatbread", "sushi", "bowl", "wrap", "fries",
    "chicken", "guacamole", "dessert", "snack", "starter", "nachos", "dumpling",
    "margherita", "hot dog", "steak", "schnitzel", "mezze", "ceviche", "dosa", "banh mi",
    "arepa", "jianbing", "roll", "crepe", "crêpe", "bagel", "lox", "cheesesteak", "gnocchi",
    "frites", "pretzel", "bite", "set menu", "bento", "tapas", "mussels", "quesadilla",
    "lunch", "dinner", "brunch", "spaghetti", "risotto", "salad", "insalata", "curry",
    "noodle", "schnitzel", "burrito", "enchilada", "kebab", "shawarma", "falafel", "soup",
]


DESSERT_WORDS = [
    "donut", "doughnut", "ice cream", "soft-serve", "soft serve", "gelato", "sorbet",
    "cheesecake", "cupcake", "pastry", "cookie", "churro", "cannoli", "tiramisu",
    "sundae", "macaron", "croissant", "brownie", "custard", "stack & sip", "sweet treat",
    "butterbeer bundle",  # "cake" is matched separately (word-boundary) to avoid pan*cake*
]
# Name/brand signals for venues that are PRIMARILY dessert/bakery shops
DESSERT_SHOP_NAMES = [
    "bakery", "bakeshop", "patisserie", "doughnut", "donut", "ice cream", "creamery",
    "gelato", "carvel", "krispy", "cinnabon", "macaron", "custard", "ladurée", "laduree",
    "cookie", "pastry", "sweets", "dessert",
]
# A savory headline means dessert is just a side, not the deal
SAVORY_MAINS = [
    "burger", "sandwich", "cheesesteak", "prix fixe", "prix-fixe", "entree", "entrée",
    "pizza", "pasta", "taco", "wing", "steak", "gyro", "ramen", "slider", "poutine",
    "schnitzel", "bento", "dosa", "platter", "three-course", "three course", "two-course",
    "two course", "dumpling", "noodle", "pancake", "set menu", "sunset menu", "dinner menu",
]


def has_drink(t):
    return any(w in t for w in DRINK_WORDS)


def has_food(t):
    return any(w in t for w in FOOD_WORDS)


def is_spend_threshold(t):
    # "spend $26 / orders of $26 / 10% off" -- a minimum-spend perk, not a curated deal
    return bool(re.search(r"spend \$?\d+|orders? of \$?\d+|totaling \$?\d+|\d+% off", t))


COCKTAIL_WORDS = [
    "cocktail", "mocktail", "margarita", "martini", "negroni", "spritz", "aperol",
    "mojito", "daiquiri", "sangria", "mezcal", "tequila", "old fashioned", "pisco sour",
    "pina colada", "piña colada", "espresso martini", "mixology", "frozen drink",
    "signature drink", "specialty drink", "tiki", "spiked", "highball", "spritzer",
    "rum punch", "chilcano", "caipirinha", "paloma", "manhattan", "whiskey sour",
]


def tag_specialty_cocktails(r, t):
    # Purely cocktail-mention driven (margarita, martini, etc.). The broad
    # "Bars/Cocktails" cuisine bucket also covers beer-only bars, so it is
    # intentionally NOT used here -- the `bars` tag covers venue type.
    return any(w in t for w in COCKTAIL_WORDS)


def tag_grab_n_go(r, t):
    if any(c in cuisines(r) for c in ["Sandwiches", "Delicatessen", "Quick Bite", "Coffeehouse"]):
        return True
    return any(w in t for w in [
        "grab-and-go", "grab and go", "grab-n-go", "to-go", "to go", "quick bite",
"deli ", "delicatessen", "counter", "slice of", "on the go", "fast-casual",
        "fast casual", "bodega", "wrap", "panini",
    ])


def tag_burger_beer(r, t):
    beer = any(w in t for w in ["beer", "draft", "draught", "pint", "lager", "ipa"])
    return "burger" in t and beer


def tag_tacos(r, t):
    if "Mexican" in cuisines(r):
        return True
    return any(w in t for w in ["taco", "taqueria", "taquería"])


def tag_meal_drink_combo(r, t):
    """A $26 deal that bundles a real food item AND a drink -- the 'money goes farther' steal."""
    if not r.get("has_26_offer"):
        return False
    return has_food(t) and has_drink(t)


def tag_food_only(r, t):
    """A substantial food deal for $26 with NO drink -- the complement of meal_drink_combo."""
    if not r.get("has_26_offer") or is_spend_threshold(t):
        return False
    return has_food(t) and not has_drink(t)


def tag_drink_only(r, t):
    """A $26 deal that is just a drink, no food -- e.g. "$26 cocktail" or a beer bucket.
    Mirror of food_only; together the three ($26 type) buckets are mutually exclusive."""
    if not r.get("has_26_offer") or is_spend_threshold(t):
        return False
    return has_drink(t) and not has_food(t)


def tag_desserts(r, t):
    if "Dessert" in cuisines(r):
        return True
    # A dedicated dessert/bakery shop (by name) counts regardless of what's in the combo
    name = (r.get("name") or "").lower()
    if any(w in name for w in DESSERT_SHOP_NAMES):
        return True
    # Otherwise: a dessert item must be the headline, not a side to a savory main.
    # "cake" matched on a word boundary so it doesn't fire on pancake/scallion pancake.
    has_dessert = any(w in t for w in DESSERT_WORDS) or bool(re.search(r"\bcakes?\b", t))
    return has_dessert and not any(m in t for m in SAVORY_MAINS)


def tag_bars(r, t):
    if "Nightlife" in taxonomy(r):
        return True
    if any(c in cuisines(r) for c in ["Bars/Cocktails", "Gastropub", "Irish", "Local Beer/Wine/Spirits Only"]):
        return True
    return any(w in t for w in [
        "sports bar", "tavern", "beer garden", "brewery", "taproom", "wine bar",
        "cocktail bar", "ale house", "beer hall", "publick house", "gin mill",
        "rum bar", "tiki bar", " lounge", " pub ", " pub.", "pub,",
    ])


def tag_watch_game(r, t):
    return any(w in t for w in [
        "watch the", "watch every", "watch all", "catch every", "catch all", "catch the",
        "live match", "televised", "on screen", "big screen", "screening", "stream",
        "sports bar", "viewing party", "games on", "matches on", "all the action",
        "game-day", "game day", "matchday", "live on", "showing the",
    ])


TAGGERS = {
    "meal_drink_combo": tag_meal_drink_combo,
    "food_only": tag_food_only,
    "drink_only": tag_drink_only,
    "specialty_cocktails": tag_specialty_cocktails,
    "grab_n_go": tag_grab_n_go,
    "burger_beer": tag_burger_beer,
    "tacos": tag_tacos,
    "bars": tag_bars,
    "watch_game": tag_watch_game,
    "desserts": tag_desserts,
}


def main():
    data = json.load(open(DATA))
    counts = Counter()
    for r in data:
        t = text(r)
        tags = [name for name, fn in TAGGERS.items() if fn(r, t)]
        r["deal_tags"] = tags
        for tag in tags:
            counts[tag] += 1

    json.dump(data, open(DATA, "w"), ensure_ascii=False, indent=2)

    print(f"Tagged {len(data)} venues -> deal_tags written to {os.path.relpath(DATA)}\n")
    print("Tag coverage:")
    for name in TAGGERS:
        print(f"  {counts[name]:4}  {name}")
    untagged = sum(1 for r in data if not r["deal_tags"])
    print(f"\n  {untagged:4}  (no deal tag)")
    print(f"  {sum(1 for r in data if r.get('has_26_offer')):4}  have $26 offer")


if __name__ == "__main__":
    main()
