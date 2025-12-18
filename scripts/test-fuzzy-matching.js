// Test script for fuzzy restaurant name matching
import { getRestaurantByNameOrSlug } from '../api/utils/dataLoader.js';

const testCases = [
  {
    name: "Test 1: Exact Slug Match",
    input: "atlantic-grill",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 2: Exact Name Match",
    input: "Atlantic Grill",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 3: Name with Article",
    input: "the palm",
    expected: "The Palm - Midtown"
  },
  {
    name: "Test 4: Partial Name Match",
    input: "atlantic",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 5: Partial substring match (atla in atlantik)",
    input: "atlantik",
    expected: "Atla"  // "atla" is substring of "atlantik"
  },
  {
    name: "Test 6: Name with special chars removed",
    input: "file gumbo",
    expected: "Filé Gumbo Bar"
  },
  {
    name: "Test 7: No Match (should return null)",
    input: "nonexistent-restaurant-xyz",
    expected: null
  },
  {
    name: "Test 8: Case Insensitivity",
    input: "ATLANTIC GRILL",
    expected: "Atlantic Grill"
  },
  {
    name: "Test 9: Gramercy Tavern (full name)",
    input: "The Dining Room at Gramercy Tavern",
    expected: "The Dining Room at Gramercy Tavern"
  },
  {
    name: "Test 10: Serra (exact slug different from name)",
    input: "serra-by-birreria",
    expected: "Serra"
  },
  {
    name: "Test 11: Le Jardinier (partial match)",
    input: "jardinier",
    expected: "Le Jardinier"
  },
  {
    name: "Test 12: Nizza (simple name)",
    input: "nizza",
    expected: "Nizza"
  }
];

console.log("🧪 Testing Fuzzy Restaurant Matching\n");
console.log("=" .repeat(80) + "\n");

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`\n${testCase.name}`);
  console.log(`Input: "${testCase.input}"`);

  const result = getRestaurantByNameOrSlug(testCase.input);
  const resultName = result ? result.name : null;

  if (testCase.expected === null) {
    if (resultName === null) {
      console.log(`✅ PASS: Correctly returned null`);
      passed++;
    } else {
      console.log(`❌ FAIL: Expected null, got "${resultName}"`);
      failed++;
    }
  } else {
    if (resultName === testCase.expected) {
      console.log(`✅ PASS: Found "${resultName}"`);
      passed++;
    } else {
      console.log(`❌ FAIL: Expected "${testCase.expected}", got "${resultName}"`);
      failed++;
    }
  }
}

console.log("\n" + "=".repeat(80));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);

if (failed === 0) {
  console.log("\n🎉 All tests passed!");
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} test(s) failed`);
  process.exit(1);
}
