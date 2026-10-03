/** Drop a location suffix: "Bar Primi - Bowery" / "Sant Ambroeus—SoHo" → the name alone.
    Splits on a spaced " - " / " – " or any em dash; hyphens inside words (Jean-Georges) stay. */
export function displayName(name: string): string {
  return name.split(/\s+[-–]\s+|\s*—\s*/)[0].trim() || name;
}
