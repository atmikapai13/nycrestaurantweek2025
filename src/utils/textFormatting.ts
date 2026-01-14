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
      pending: "Remi is whisking through the database...",
      done: "Remi found some fresh ingredients (data)!",
    },
    get_isochrone: {
      pending: "Remi is measuring the city's heartbeat...",
      done: "The area is mapped, chef!",
    },
    get_isoline: {
      pending: "Remi is measuring the city's heartbeat...",
      done: "The area is mapped, chef!",
    },
    geocode: {
      pending: "Remi is locating the spot on the map...",
      done: "Found the coordinates!",
    },
    search_documents: {
      pending: "Remi is leafing through his recipe books (reviews)...",
      done: "He's found some tasty rumors!",
    },
    displayRestaurants: {
      pending: "Remi is plating your recommendations...",
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

