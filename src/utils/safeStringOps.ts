/**
 * Safe string operations utility
 * Prevents null/undefined errors when working with restaurant data
 */

/**
 * Safely convert to lowercase with null/undefined handling
 */
export function safeLowerCase(str: string | null | undefined): string {
  return (str || '').toLowerCase()
}

/**
 * Safely check if a string includes another string
 */
export function safeIncludes(
  str: string | null | undefined,
  search: string | null | undefined
): boolean {
  if (!str || !search) return false
  return str.toLowerCase().includes(search.toLowerCase())
}

/**
 * Safely filter and map an array
 */
export function safeArrayMap<T, R>(
  arr: T[] | null | undefined,
  mapFn: (item: T) => R
): R[] {
  return (arr || []).filter(item => item != null).map(mapFn)
}

/**
 * Safely check if array includes a value
 */
export function safeArrayIncludes<T>(
  arr: T[] | null | undefined,
  value: T
): boolean {
  return (arr || []).includes(value)
}

/**
 * Get safe string value with fallback
 */
export function getSafeString(
  value: string | null | undefined,
  fallback: string = ''
): string {
  return value ?? fallback
}
