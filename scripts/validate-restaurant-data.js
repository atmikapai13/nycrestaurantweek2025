#!/usr/bin/env node

/**
 * Data Validation Script
 * Checks for null/undefined fields in restaurant data
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load restaurant data
const dataPath = path.join(__dirname, '../src/data/FinalData.json')
const restaurants = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

console.log(`\n📊 Validating ${restaurants.length} restaurants...\n`)

// Fields to check
const requiredFields = ['name', 'slug', 'cuisine', 'neighborhood', 'latitude', 'longitude']
const recommendedFields = ['summary', 'yelp_review_highlights', 'collections', 'meal_types', 'price']

// Track issues
const issues = {
  missingRequired: [],
  missingRecommended: [],
  nullValues: [],
  emptyArrays: []
}

restaurants.forEach((restaurant, index) => {
  const restaurantIssues = []

  // Check required fields
  requiredFields.forEach(field => {
    if (!restaurant[field]) {
      restaurantIssues.push(`Missing required: ${field}`)
      issues.missingRequired.push({
        index,
        slug: restaurant.slug || `index-${index}`,
        field,
        name: restaurant.name || 'UNNAMED'
      })
    }
  })

  // Check recommended fields
  recommendedFields.forEach(field => {
    if (!restaurant[field]) {
      restaurantIssues.push(`Missing recommended: ${field}`)
      issues.missingRecommended.push({
        index,
        slug: restaurant.slug || `index-${index}`,
        field,
        name: restaurant.name || 'UNNAMED'
      })
    }
  })

  // Check for explicitly null values
  Object.entries(restaurant).forEach(([key, value]) => {
    if (value === null) {
      restaurantIssues.push(`Null value: ${key}`)
      issues.nullValues.push({
        index,
        slug: restaurant.slug,
        field: key,
        name: restaurant.name
      })
    }
  })

  // Check for empty arrays
  if (Array.isArray(restaurant.collections) && restaurant.collections.length === 0) {
    // This is OK - not all restaurants have collections
  }
  if (Array.isArray(restaurant.meal_types) && restaurant.meal_types.length === 0) {
    issues.emptyArrays.push({
      index,
      slug: restaurant.slug,
      field: 'meal_types',
      name: restaurant.name
    })
  }

  // Log restaurants with issues
  if (restaurantIssues.length > 0) {
    console.log(`⚠️  Restaurant #${index} (${restaurant.name || 'UNNAMED'}):`)
    restaurantIssues.forEach(issue => console.log(`   - ${issue}`))
  }
})

// Summary
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`📋 VALIDATION SUMMARY`)
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

console.log(`Total restaurants: ${restaurants.length}`)
console.log(`\n🔴 Critical Issues (Missing Required Fields):`)
if (issues.missingRequired.length === 0) {
  console.log(`   ✅ None! All restaurants have required fields.`)
} else {
  const byField = {}
  issues.missingRequired.forEach(issue => {
    byField[issue.field] = (byField[issue.field] || 0) + 1
  })
  Object.entries(byField).forEach(([field, count]) => {
    console.log(`   - ${field}: ${count} restaurants`)
  })
  console.log(`\n   First 10 affected:`)
  issues.missingRequired.slice(0, 10).forEach(issue => {
    console.log(`   - ${issue.name} (${issue.slug}): missing ${issue.field}`)
  })
}

console.log(`\n🟡 Warnings (Missing Recommended Fields):`)
if (issues.missingRecommended.length === 0) {
  console.log(`   ✅ None! All restaurants have recommended fields.`)
} else {
  const byField = {}
  issues.missingRecommended.forEach(issue => {
    byField[issue.field] = (byField[issue.field] || 0) + 1
  })
  Object.entries(byField).forEach(([field, count]) => {
    console.log(`   - ${field}: ${count} restaurants`)
  })
}

console.log(`\n🔵 Info (Null Values):`)
if (issues.nullValues.length === 0) {
  console.log(`   ✅ None! No explicitly null values found.`)
} else {
  const byField = {}
  issues.nullValues.forEach(issue => {
    byField[issue.field] = (byField[issue.field] || 0) + 1
  })
  Object.entries(byField).forEach(([field, count]) => {
    console.log(`   - ${field}: ${count} restaurants`)
  })
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

// Generate fix recommendations
if (issues.missingRequired.length > 0) {
  console.log(`⚠️  ACTION REQUIRED: ${issues.missingRequired.length} critical issues found`)
  console.log(`   Run data cleanup to fill in missing required fields\n`)
} else if (issues.missingRecommended.length > 0) {
  console.log(`✅ No critical issues, but ${issues.missingRecommended.length} recommendations`)
  console.log(`   Consider adding missing recommended fields for better UX\n`)
} else {
  console.log(`✅ All validation checks passed! Data quality is excellent.\n`)
}

// Export results to JSON for further analysis
const resultsPath = path.join(__dirname, '../validation-results.json')
fs.writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  totalRestaurants: restaurants.length,
  summary: {
    missingRequired: issues.missingRequired.length,
    missingRecommended: issues.missingRecommended.length,
    nullValues: issues.nullValues.length,
    emptyArrays: issues.emptyArrays.length
  },
  details: issues
}, null, 2))

console.log(`📄 Full results exported to: validation-results.json\n`)
