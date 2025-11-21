/**
 * NYC Slang Dictionary
 * Expands common NYC abbreviations and slang to full neighborhood names
 * for improved geocoding accuracy
 */

const NYC_SLANG_MAP: Record<string, string> = {
  // Manhattan neighborhoods
  'lic': 'Long Island City',
  'fidi': 'Financial District',
  'tribeca': 'TriBeCa',
  'soho': 'SoHo',
  'noho': 'NoHo',
  'nolita': 'NoLita',
  'ev': 'East Village',
  'wv': 'West Village',
  'les': 'Lower East Side',
  'uws': 'Upper West Side',
  'ues': 'Upper East Side',
  'hk': "Hell's Kitchen",
  'kb': "Kip's Bay",
  "kip's bay": "Kip's Bay",
  'hells kitchen': "Hell's Kitchen",
  'midtown': 'Midtown Manhattan',
  'times sq': 'Times Square',
  'times square': 'Times Square',
  'grand central': 'Grand Central Terminal',
  'penn station': 'Pennsylvania Station',
  'port authority': 'Port Authority Bus Terminal',
  'the village': 'Greenwich Village',
  'wash sq': 'Washington Square',
  'union sq': 'Union Square',
  'madison sq': 'Madison Square',
  'columbus circle': 'Columbus Circle',
  'lincoln center': 'Lincoln Center',
  'battery park': 'Battery Park City',
  'wtc': 'World Trade Center',
  'the vessel': 'Hudson Yards',
  'nyu': 'New York University',
  'columbia': 'Columbia University',

  // Brooklyn neighborhoods
  'williamsburg': 'Williamsburg',
  'wburg': 'Williamsburg',
  'dumbo': 'DUMBO',
  'bk': 'Brooklyn',
  'park slope': 'Park Slope',
  'prospect heights': 'Prospect Heights',
  'crown heights': 'Crown Heights',
  'bed stuy': 'Bedford-Stuyvesant',
  'bed-stuy': 'Bedford-Stuyvesant',
  'bushwick': 'Bushwick',
  'greenpoint': 'Greenpoint',
  'fort greene': 'Fort Greene',
  'brooklyn heights': 'Brooklyn Heights',
  'carroll gardens': 'Carroll Gardens',
  'cobble hill': 'Cobble Hill',
  'red hook': 'Red Hook',
  'sunset park': 'Sunset Park',
  'bay ridge': 'Bay Ridge',
  'dyker heights': 'Dyker Heights',
  'bensonhurst': 'Bensonhurst',
  'coney island': 'Coney Island',

  // Queens neighborhoods
  'astoria': 'Astoria',
  'lic': 'Long Island City',
  'sunnyside': 'Sunnyside',
  'woodside': 'Woodside',
  'jackson heights': 'Jackson Heights',
  'elmhurst': 'Elmhurst',
  'corona': 'Corona',
  'flushing': 'Flushing',
  'forest hills': 'Forest Hills',
  'rego park': 'Rego Park',
  'kew gardens': 'Kew Gardens',
  'jamaica': 'Jamaica',
  'rockaway': 'Rockaway Beach',

  // Bronx neighborhoods
  'the bronx': 'Bronx',
  'bx': 'Bronx',
  'yankee stadium': 'Yankee Stadium',
  'fordham': 'Fordham',
  'riverdale': 'Riverdale',
  'city island': 'City Island',

  // Staten Island
  'si': 'Staten Island',
  'staten island': 'Staten Island',

  // General NYC references
  'nyc': 'New York City',
  'new york': 'New York City',
  'manhattan': 'Manhattan',
  'downtown': 'Downtown Manhattan',
  'uptown': 'Uptown Manhattan',
  'midtown west': 'Midtown West',
  'midtown east': 'Midtown East'
}

/**
 * Expands NYC slang and abbreviations to full place names
 * @param query - User input that may contain NYC slang
 * @returns Expanded query with full place names
 */
export function expandNYCSlang(query: string): string {
  if (!query || typeof query !== 'string') {
    return query
  }

  let expanded = query.toLowerCase().trim()

  // Try exact match first
  if (NYC_SLANG_MAP[expanded]) {
    return NYC_SLANG_MAP[expanded]
  }

  // Try partial replacement for multi-word queries
  // Example: "restaurants in lic" → "restaurants in Long Island City"
  for (const [slang, formal] of Object.entries(NYC_SLANG_MAP)) {
    // Use word boundaries to avoid partial word replacement
    const regex = new RegExp(`\\b${slang}\\b`, 'gi')
    expanded = expanded.replace(regex, formal)
  }

  return expanded
}

/**
 * Check if a query contains NYC-specific slang
 * @param query - User input
 * @returns true if query contains recognizable NYC slang
 */
export function containsNYCSlang(query: string): boolean {
  if (!query || typeof query !== 'string') {
    return false
  }

  const lowerQuery = query.toLowerCase()
  return Object.keys(NYC_SLANG_MAP).some(slang =>
    lowerQuery.includes(slang)
  )
}

/**
 * Get all known NYC slang terms (for debugging/testing)
 */
export function getAllSlangTerms(): string[] {
  return Object.keys(NYC_SLANG_MAP)
}
