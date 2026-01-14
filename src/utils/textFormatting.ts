/**
 * Text formatting utilities for chat messages
 * Handles markdown conversion, link detection, and message classification
 */

/**
 * Convert markdown and URLs in text to HTML
 * Supports: lists, bold, italic, and clickable links
 */
export function linkifyText(text: string): string {
  let result = text;

  // Handle markdown list items
  result = result.replace(/^[\*\-]\s+(.+)$/gm, "• $1");

  // Bold: **text** → <strong>text</strong>
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic: *text* → <em>text</em>
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // URLs with protocol
  result = result.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">$1</a>'
  );

  // URLs without protocol
  result = result.replace(
    /(?<!href="|">)(?:^|\s)((?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)/g,
    (match, url, offset) => {
      const beforeMatch = result.substring(0, offset);
      if (beforeMatch.lastIndexOf("<a") > beforeMatch.lastIndexOf("</a>")) {
        return match;
      }
      return match.replace(
        url,
        `<a href="https://${url}" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">${url}</a>`
      );
    }
  );

  return result;
}

/**
 * Check if a message contains a buy-me-coffee link
 * Used to show meta-learning suggestions after donation prompts
 */
export function isBuyMeCoffeeMessage(content: string): boolean {
  return content.toLowerCase().includes("buymeacoffee.com/atmikapai");
}

/**
 * Get a user-friendly status message for a tool call
 */
export function getToolStatusMessage(
  toolName: string,
  isPending: boolean
): string {
  const statusMessages: Record<string, { pending: string; done: string }> = {
    execute_sql: {
      pending: "I'm scurrying through the database...",
      done: "I've found some delectable spots!",
    },
    get_isochrone: {
      pending: "My friends in the subway have helped me map NYC pretty accurately...",
      done: "The area is mapping, chef!",
    },
    get_isoline: {
      pending: "My friends in the subway have helped me map NYC pretty accurately...",
      done: "The area is mapping, monsieur!",
    },
    geocode: {
      pending: "I'm locating the spot on the map...",
      done: "My friends in the subway helped me figure out the coordinates!",
    },
    search_documents: {
      pending: "I'm leafing through my recipe books...",
      done: "I've found some tasty delights!",
    },
    displayRestaurants: {
      pending: "I'm plating your recommendations...",
      done: "Bon appétit! Here are your options:",
    },
  };

  const messages = statusMessages[toolName];
  if (messages) {
    return isPending ? messages.pending : messages.done;
  }

  return isPending
    ? `Remi is using his ${toolName} trick...`
    : `The ${toolName} is served!`;
}

