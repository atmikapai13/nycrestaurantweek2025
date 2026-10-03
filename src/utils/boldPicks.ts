import { displayName } from "./restaurantName";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Bold the first mention of each of Remi's picks in his reply (as markdown **name**, which the
 * chat renders), so the restaurants stand out: "The Otter for cocktail hour" → "**The Otter**
 * for cocktail hour". Matches the full name or the name without its location suffix; names
 * that are already bold, or that Remi doesn't mention, are left alone.
 */
export function boldPicks(text: string, picks: { name: string }[]): string {
  let result = text;
  for (const pick of picks) {
    const names = [...new Set([pick.name, displayName(pick.name)])].sort((a, b) => b.length - a.length);
    for (const name of names) {
      const pattern = new RegExp(`(\\*\\*)?(?<![\\w])${escape(name)}(?![\\w])(\\*\\*)?`);
      const match = pattern.exec(result);
      if (!match) continue;
      if (!(match[1] && match[2])) {
        const plain = match[0].replace(/\*\*/g, "");
        result = `${result.slice(0, match.index)}**${plain}**${result.slice(match.index + match[0].length)}`;
      }
      break;
    }
  }
  return result;
}
