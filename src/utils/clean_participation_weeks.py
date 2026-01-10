#!/usr/bin/env python3
"""
One-time cleanup script to remove "Week X " prefix from participation_weeks in all JSON files.
This fixes any remaining entries that weren't processed by the 3_Characteristics.py cleaner.
"""

import json
import re
import os
from pathlib import Path

def clean_participation_weeks(weeks_list):
    """Remove 'Week X ' prefix from participation_weeks array items."""
    if not weeks_list or not isinstance(weeks_list, list):
        return weeks_list

    cleaned_weeks = []

    for week in weeks_list:
        if isinstance(week, str):
            # Hard-coded removal of "Week 1", "Week 2", "Week 3", "Week 4" prefixes
            cleaned = week

            # Remove all variations (handles multiple parentheses issue)
            cleaned = cleaned.replace("Week 1 (", "")
            cleaned = cleaned.replace("Week 2 (", "")
            cleaned = cleaned.replace("Week 3 (", "")
            cleaned = cleaned.replace("Week 4 (", "")

            # Also handle lowercase
            cleaned = cleaned.replace("week 1 (", "")
            cleaned = cleaned.replace("week 2 (", "")
            cleaned = cleaned.replace("week 3 (", "")
            cleaned = cleaned.replace("week 4 (", "")

            # Remove trailing parentheses
            if cleaned.endswith(")"):
                cleaned = cleaned[:-1]

            # If the string still starts with "Week" (any variation), use regex fallback
            if cleaned.lower().startswith("week"):
                pattern = r'Week\s+\d+\s+\(([^)]+)\)'
                match = re.search(pattern, week, re.IGNORECASE)
                if match:
                    cleaned = match.group(1)

            cleaned_weeks.append(cleaned.strip())
        else:
            cleaned_weeks.append(week)

    return cleaned_weeks

def clean_json_file(file_path):
    """Clean a single JSON file."""
    print(f"Processing {file_path}...")

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if not isinstance(data, list):
            print(f"  ⚠️  Skipping (not a list of restaurants)")
            return

        cleaned_count = 0
        for restaurant in data:
            if 'participation_weeks' in restaurant:
                original = restaurant['participation_weeks']
                cleaned = clean_participation_weeks(original)

                if original != cleaned:
                    restaurant['participation_weeks'] = cleaned
                    cleaned_count += 1

        if cleaned_count > 0:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"  ✅ Cleaned {cleaned_count} restaurants")
        else:
            print(f"  ✓ Already clean")

    except Exception as e:
        print(f"  ❌ Error: {e}")

def main():
    """Clean all relevant JSON files in the project."""

    # Define files to clean
    files_to_clean = [
        'src/data/FinalData.json',
        'src/data/NYCRestaurantWeek/1_Scraped.json',
        'src/data/NYCRestaurantWeek/2_Geocoded.json',
        'src/data/NYCRestaurantWeek/3_Characteristics.json',
        'src/data/NYCRestaurantWeek/4_JoinMichelin.json',
        'src/data/NYCRestaurantWeek/5_JoinNYT.json',
        'src/data/NYCRestaurantWeek/nycrestaurantweek2025.json',
        'src/data/NYCRestaurantWeek/nycrestaurantweek2026.json'
    ]

    print("🧹 Cleaning participation_weeks in all JSON files...\n")

    # Get project root (assuming script is in src/utils/)
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent

    for file_path in files_to_clean:
        full_path = project_root / file_path

        if full_path.exists():
            clean_json_file(full_path)
        else:
            print(f"⚠️  {file_path} not found, skipping")

    print("\n🎉 Cleanup complete!")

if __name__ == "__main__":
    main()
