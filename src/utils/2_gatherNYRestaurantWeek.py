#!/usr/bin/env python3
"""
NYC Restaurant Week Data Pipeline Runner
Runs all scripts in the src/utils/NYCRestaurantWeek directory in order.
"""

import subprocess
import sys
import os
from datetime import datetime

def run_script(script_path, description):
    """Run a Python script and handle errors."""
    print(f"\n{'='*60}")
    print(f"🔄 Running: {description}")
    print(f"📁 Script: {script_path}")
    print(f"⏰ Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    try:
        # Set working directory to src/utils
        utils_dir = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run([sys.executable, script_path],
                              capture_output=True,
                              text=True,
                              cwd=utils_dir)

        if result.returncode == 0:
            print(f"✅ Success: {description}")
            if result.stdout:
                print("📤 Output:")
                print(result.stdout)
        else:
            print(f"❌ Error: {description}")
            print(f"Error code: {result.returncode}")
            if result.stderr:
                print("📤 Error output:")
                print(result.stderr)
            if result.stdout:
                print("📤 Standard output:")
                print(result.stdout)
            return False

    except FileNotFoundError:
        print(f"❌ File not found: {script_path}")
        return False
    except Exception as e:
        print(f"❌ Exception running {script_path}: {str(e)}")
        return False

    return True

def main():
    """Run all NYC Restaurant Week scripts in order."""
    print("🚀 Starting NYC Restaurant Week Data Pipeline")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Define the scripts to run in order
    scripts = [
        {
            "path": "NYCRestaurantWeek/1_Scraper.py",
            "description": "NYC Restaurant Week Scraper"
        },
        {
            "path": "NYCRestaurantWeek/2_Geocoder.py",
            "description": "Restaurant Geocoding"
        },
        {
            "path": "NYCRestaurantWeek/3_Characteristics.py",
            "description": "Restaurant Characteristics Processing"
        },
        {
            "path": "NYCRestaurantWeek/4_join_data.py",
            "description": "Data Joining and Final Processing"
        }
    ]

    successful_scripts = []
    failed_scripts = []

    for i, script in enumerate(scripts, 1):
        print(f"\n📋 Step {i}/{len(scripts)}")

        if run_script(script["path"], script["description"]):
            successful_scripts.append(script["description"])
        else:
            failed_scripts.append(script["description"])
            print(f"\n⚠️  Pipeline stopped due to error in: {script['description']}")
            print("🛑 You may need to fix the error and restart the pipeline.")
            break

    print(f"\n{'='*60}")
    print("📊 NYC RESTAURANT WEEK PIPELINE SUMMARY")
    print(f"{'='*60}")
    print(f"✅ Successful: {len(successful_scripts)}")
    print(f"❌ Failed: {len(failed_scripts)}")

    if successful_scripts:
        print("\n✅ Successfully completed:")
        for script in successful_scripts:
            print(f"   • {script}")

    if failed_scripts:
        print("\n❌ Failed:")
        for script in failed_scripts:
            print(f"   • {script}")

    if not failed_scripts:
        print("\n🎉 All NYC Restaurant Week scripts completed successfully!")
        print("📁 Check the output files in src/data/NYCRestaurantWeek/")
        print("📁 Final data available in src/data/FinalData.json")
    else:
        print(f"\n⚠️  Pipeline completed with {len(failed_scripts)} error(s).")
        print("🔧 Please fix the errors and re-run the pipeline.")

    print(f"\n⏰ Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main() 