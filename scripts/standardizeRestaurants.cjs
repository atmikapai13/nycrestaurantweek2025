const fs = require('fs');
const path = require('path');

// Read the FinalData.json file
const filePath = path.join(__dirname, '../src/data/FinalData.json');
const rawData = fs.readFileSync(filePath, 'utf8');
const restaurants = JSON.parse(rawData);

console.log(`Processing ${restaurants.length} restaurants...`);

// Atlantic Grill's 23-field structure (in order)
const atlanticGrillFields = [
  'name',
  'slug',
  'borough',
  'neighborhood',
  'address',
  'latitude',
  'longitude',
  'cuisine',
  'price',
  'available',
  'summary',
  'collections',
  'opentable_id',
  'telephone',
  'michelin_award',
  'nyttop100_rank',
  'yelp_rating',
  'yelp_review_count',
  'yelp_url',
  'yelp_review_highlights',
  'website',
  'facebook_url',
  'instagram_url'
];

// Transform each restaurant to match Atlantic Grill structure
const standardizedRestaurants = restaurants.map((restaurant, index) => {
  const standardized = {};

  // Go through each field in Atlantic Grill's structure
  atlanticGrillFields.forEach(field => {
    if (restaurant.hasOwnProperty(field)) {
      // Field exists, keep its value
      standardized[field] = restaurant[field];
    } else {
      // Field doesn't exist, add empty value based on type
      if (field === 'collections') {
        standardized[field] = [];
      } else if (field === 'yelp_rating') {
        standardized[field] = null; // or 0 if you prefer
      } else if (field === 'yelp_review_count') {
        standardized[field] = null; // or 0 if you prefer
      } else if (field === 'latitude' || field === 'longitude') {
        standardized[field] = restaurant[field] || null;
      } else {
        // All other fields default to empty string
        standardized[field] = '';
      }
    }
  });

  if ((index + 1) % 100 === 0) {
    console.log(`Processed ${index + 1} restaurants...`);
  }

  return standardized;
});

// Write the standardized data back to FinalData.json
fs.writeFileSync(filePath, JSON.stringify(standardizedRestaurants, null, 2), 'utf8');

console.log(`\n✅ Successfully standardized ${standardizedRestaurants.length} restaurants!`);
console.log(`All restaurants now have the same 23-field structure as Atlantic Grill.`);
console.log(`\nRemoved fields: meal_types, participation_weeks, menu_url, image_url, primary_location, price_range, michelin_slug, reddit, extraction_success, extraction_method`);
