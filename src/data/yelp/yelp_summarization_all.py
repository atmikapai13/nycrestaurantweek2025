import json
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Thread-safe lock for printing
print_lock = Lock()

def generate_summary(categories, highlights, restaurant_name):
    """Send prompt to OpenAI and get summary"""

    # Build prompt based on what data we have
    if categories and highlights:
        prompt = f"""You are summarizing Yelp review highlights for a restaurant recommendation platform.

Given the following review highlights data and Yelp categories, create a concise summary that:
1. Starts with ONE sentence: "Yelp categorizes this spot as [list categories]."
2. Follows with 2-4 sentences starting with "In Yelp reviews,..." that naturally weaves together what reviewers discuss
3. CRITICAL: The percentages show how many reviews MENTION a topic, NOT whether reviews are positive or negative. DO NOT assume sentiment is universal.
4. Use neutral framing like "talk about," "mention," "discuss," or "bring up" - NEVER "rave about," "love," or "praise"
5. Include percentages naturally: "mentioned in X% of reviews" or "X% of reviewers discuss..."
6. Extract and name ALL specific dishes, drinks, and staff members mentioned in the example sentences
7. Keep it conversational - imagine explaining to a friend what people are saying about this place

CRITICAL RULES:
- Total length: 3-5 sentences (1 for categories + 2-4 for highlights)
- Only include highlights where review_count_percent > 3%
- List highlights in order from highest to lowest percentage
- When mentioning dishes/drinks, use the EXACT names from the sentences
- Be specific but concise - no meta-commentary
- Avoid repetitive phrases - vary your language
- Write naturally, not formally
- NEVER generalize sentiment - the example sentence shows ONE person's view, not everyone's

BAD example (overgeneralizes sentiment):
"In Yelp reviews, the service is deemed exceptional, with 47% raving about bartender Kayla's excellent Cosmopolitans."

GOOD example (neutral, factual):
"In Yelp reviews, service comes up in 47% of reviews, with one diner mentioning bartender Kayla's Cosmopolitan and fresh food."

ANOTHER GOOD example:
"In Yelp reviews, drinks are discussed in 45% of reviews, with mentions of the We Limin' and Henneycolada. The Oxtail Flatbread comes up too, along with dishes like the Ackee & Saltfish Stuffed Plantains."

Now summarize this restaurant:

yelp_categories: {json.dumps(categories)}

review_highlights: {json.dumps(highlights, indent=2)}"""
    else:
        # No categories, just highlights
        prompt = f"""You are summarizing Yelp review highlights for a restaurant recommendation platform.

Given the following review highlights data (no categories available), create a concise summary that:
1. Starts with 2-4 sentences starting with "In Yelp reviews..." that naturally weaves together what reviewers discuss
2. CRITICAL: The percentages show how many reviews MENTION a topic, NOT whether reviews are positive or negative. DO NOT assume sentiment is universal.
3. Use neutral framing like "talk about," "mention," "discuss," or "bring up" - NEVER "rave about," "love," or "praise"
4. Include percentages naturally: "mentioned in X% of reviews" or "X% of reviewers discuss..."
5. Extract and name ALL specific dishes, drinks, and staff members mentioned in the example sentences
6. Keep it conversational - imagine explaining to a friend what people are saying about this place

CRITICAL RULES:
- Total length: 2-4 sentences
- Only include highlights where review_count_percent > 3%
- List highlights in order from highest to lowest percentage
- When mentioning dishes/drinks, use the EXACT names from the sentences
- Be specific but concise - no meta-commentary
- Avoid repetitive phrases - vary your language
- Write naturally, not formally
- NEVER generalize sentiment - the example sentence shows ONE person's view, not everyone's

BAD example (overgeneralizes sentiment):
"Yelpers rave about the pasta, with 31.5% loving the pesto pasta with shrimp."

GOOD example (neutral, factual):
"Yelpers discuss pasta in 31.5% of reviews, with mentions of the pesto pasta with shrimp and pine nuts."

Now summarize this restaurant:

review_highlights: {json.dumps(highlights, indent=2)}"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise assistant that summarizes what topics restaurant reviewers mention, WITHOUT assuming everyone shares the same opinion. Stay neutral and factual."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=300
        )
        
        usage = response.usage
        return response.choices[0].message.content.strip(), usage
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return None, None


def process_restaurant(idx, restaurant, total):
    """Process a single restaurant (called in parallel)"""

    name = restaurant.get('name', 'Unknown')
    categories = restaurant.get('yelp_categories', [])
    highlights_data = restaurant.get('yelp_highlights', {}) or {}
    highlights = highlights_data.get('review_highlights', [])

    # Filter highlights > 3%
    filtered_highlights = []
    for h in highlights:
        percent_str = h.get('review_count_percent', '0%')
        try:
            percent = float(percent_str.rstrip('%'))
            if percent > 3.0:
                filtered_highlights.append(h)
        except (ValueError, AttributeType):
            continue

    # Skip only if BOTH no categories AND no highlights
    if not categories and not filtered_highlights:
        with print_lock:
            print(f"[{idx}/{total}] {name} - ⊘ Skipped (no categories and no highlights)")
        return {
            'idx': idx,
            'restaurant': restaurant,
            'status': 'skipped',
            'summary': None,
            'usage': None
        }

    # If no highlights but has categories, generate categories-only summary
    if not filtered_highlights and categories:
        categories_str = ", ".join(categories)
        summary = f"Yelp categorizes this spot as {categories_str}."
        with print_lock:
            print(f"[{idx}/{total}] {name} - ✓ Generated (categories only)")
            print(f"  {summary}")
        return {
            'idx': idx,
            'restaurant': restaurant,
            'status': 'success',
            'summary': summary,
            'usage': None  # No API call made
        }

    # If no categories but has highlights, generate highlights-only summary
    if not categories and filtered_highlights:
        result = generate_summary([], filtered_highlights, name)

        if len(result) == 3:  # Error case
            summary, usage, error = result
            with print_lock:
                print(f"[{idx}/{total}] {name} - ✗ Failed: {error}")
            return {
                'idx': idx,
                'restaurant': restaurant,
                'status': 'failed',
                'summary': None,
                'usage': None
            }
        else:
            summary, usage = result
            if summary and usage:
                preview = summary[:80] + "..." if len(summary) > 80 else summary
                with print_lock:
                    print(f"[{idx}/{total}] {name} - ✓ Generated (highlights only, no categories)")
                    print(f"  {preview}")
                return {
                    'idx': idx,
                    'restaurant': restaurant,
                    'status': 'success',
                    'summary': summary,
                    'usage': usage
                }
            else:
                with print_lock:
                    print(f"[{idx}/{total}] {name} - ✗ Failed")
                return {
                    'idx': idx,
                    'restaurant': restaurant,
                    'status': 'failed',
                    'summary': None,
                    'usage': None
                }

    # Has both categories and highlights - generate full summary
    result = generate_summary(categories, filtered_highlights, name)

    if len(result) == 3:  # Error case
        summary, usage, error = result
        with print_lock:
            print(f"[{idx}/{total}] {name} - ✗ Failed: {error}")
        return {
            'idx': idx,
            'restaurant': restaurant,
            'status': 'failed',
            'summary': None,
            'usage': None
        }
    else:
        summary, usage = result
        if summary and usage:
            preview = summary[:80] + "..." if len(summary) > 80 else summary
            with print_lock:
                print(f"[{idx}/{total}] {name} - ✓ Generated")
                print(f"  {preview}")
            return {
                'idx': idx,
                'restaurant': restaurant,
                'status': 'success',
                'summary': summary,
                'usage': usage
            }
        else:
            with print_lock:
                print(f"[{idx}/{total}] {name} - ✗ Failed")
            return {
                'idx': idx,
                'restaurant': restaurant,
                'status': 'failed',
                'summary': None,
                'usage': None
            }


def process_all_restaurants_parallel(input_file, output_file, max_workers=10):
    """Process ALL restaurants using parallel processing"""

    print(f"Loading restaurants from {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        restaurants = json.load(f)

    total = len(restaurants)
    print(f"Processing {total} restaurants with {max_workers} parallel workers\n")
    print("="*60)

    processed = 0
    successful = 0
    skipped = 0
    failed = 0
    start_time = time.time()

    # Cost tracking
    total_input_tokens = 0
    total_output_tokens = 0

    # Process in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_idx = {
            executor.submit(process_restaurant, idx, restaurant, total): idx
            for idx, restaurant in enumerate(restaurants, 1)
        }

        # Collect results as they complete
        for future in as_completed(future_to_idx):
            result = future.result()

            # Update restaurant with summary
            restaurant_idx = result['idx'] - 1  # Convert to 0-based index
            restaurants[restaurant_idx]['yelp_summary'] = result['summary']

            # Update counters
            processed += 1
            if result['status'] == 'success':
                successful += 1
                # Only add tokens if usage is not None (API call was made)
                if result['usage'] is not None:
                    total_input_tokens += result['usage'].prompt_tokens
                    total_output_tokens += result['usage'].completion_tokens
            elif result['status'] == 'skipped':
                skipped += 1
            else:
                failed += 1

            # Save progress every 50 restaurants
            if processed % 50 == 0:
                with print_lock:
                    print(f"\n{'='*60}")
                    print(f"💾 Saving progress... ({processed}/{total})")
                    with open(output_file, 'w', encoding='utf-8') as f:
                        json.dump(restaurants, f, indent=2, ensure_ascii=False)

                    elapsed = time.time() - start_time
                    avg_time = elapsed / processed
                    remaining = (total - processed) * avg_time

                    # Calculate costs so far
                    input_cost = (total_input_tokens / 1_000_000) * 0.150
                    output_cost = (total_output_tokens / 1_000_000) * 0.600
                    current_cost = input_cost + output_cost

                    print(f"Stats: ✓{successful} | ⊘{skipped} | ✗{failed}")
                    print(f"Cost so far: ${current_cost:.4f}")
                    print(f"Time: {elapsed/60:.1f}m elapsed, ~{remaining/60:.1f}m remaining")
                    print(f"{'='*60}\n")

    # Final save
    print(f"\n💾 Saving final results to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(restaurants, f, indent=2, ensure_ascii=False)

    # Calculate final costs
    input_cost = (total_input_tokens / 1_000_000) * 0.150
    output_cost = (total_output_tokens / 1_000_000) * 0.600
    total_cost = input_cost + output_cost

    # Final stats
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"✓ COMPLETE!")
    print(f"{'='*60}")
    print(f"Total processed: {processed}/{total}")
    print(f"Successful: {successful}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")
    print(f"\n--- TOKEN USAGE ---")
    print(f"Total tokens: {total_input_tokens + total_output_tokens:,}")
    print(f"  Input: {total_input_tokens:,} tokens")
    print(f"  Output: {total_output_tokens:,} tokens")
    print(f"\n--- COST BREAKDOWN ---")
    print(f"Total cost: ${total_cost:.4f}")
    print(f"  Input: ${input_cost:.4f}")
    print(f"  Output: ${output_cost:.4f}")
    print(f"\nTotal time: {elapsed/60:.1f} minutes")
    print(f"Average: {elapsed/processed:.1f}s per restaurant")
    print(f"{'='*60}")


if __name__ == "__main__":
    INPUT_FILE = "yelp/restaurant_yelp.json"
    OUTPUT_FILE = "yelp/restaurant_yelp_summarization.json"

    # Process with 10 parallel workers (adjust if needed)
    process_all_restaurants_parallel(INPUT_FILE, OUTPUT_FILE, max_workers=10)
