// Test fuzzy matching with the get_restaurant_details tool
import { getRestaurantDetails } from '../api/langgraph/tools.js';

console.log("🧪 Testing Fuzzy Matching with get_restaurant_details Tool\n");
console.log("=".repeat(80) + "\n");

const testCases = [
  {
    name: "Test 1: Exact slug",
    input: "atlantic-grill",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 2: Full name",
    input: "Atlantic Grill",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 3: Name with article",
    input: "the palm",
    expected: "The Palm - Midtown"
  },
  {
    name: "Test 4: Partial name",
    input: "jardinier",
    expected: "Le Jardinier"
  },
  {
    name: "Test 5: Special chars normalized",
    input: "file gumbo",
    expected: "Filé Gumbo Bar"
  }
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`${testCase.name}`);
  console.log(`  Input: "${testCase.input}"`);

  try {
    const result = await getRestaurantDetails.func({
      restaurantSlug: testCase.input,
      detailType: "full"
    });

    const parsed = JSON.parse(result);

    if (parsed.error) {
      console.log(`  ❌ FAIL: ${parsed.error}`);
      failed++;
    } else if (parsed.name === testCase.expected) {
      console.log(`  ✅ PASS: Found "${parsed.name}"`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: Expected "${testCase.expected}", got "${parsed.name}"`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: Error - ${error.message}`);
    failed++;
  }

  console.log("");
}

console.log("=".repeat(80));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests\n`);

if (failed === 0) {
  console.log("🎉 All fuzzy matching tests passed!");
  process.exit(0);
} else {
  console.log(`⚠️  ${failed} test(s) failed`);
  process.exit(1);
}
