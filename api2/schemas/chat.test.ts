/**
 * Example test cases for chat request validation
 * Run with: npm test (if test runner configured)
 */

import { describe, it, expect } from "@jest/globals";
import { safeParseChatRequest } from "./chat";

describe("Chat Request Validation", () => {
  it("should accept valid chat request with UIMessage format", () => {
    const validRequest = {
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "Find me Italian restaurants in Manhattan",
            },
          ],
        },
      ],
    };

    const result = safeParseChatRequest(validRequest);
    expect(result.success).toBe(true);
  });

  it("should accept messages with content field (legacy format)", () => {
    const legacyRequest = {
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Find me Italian restaurants",
        },
      ],
    };

    const result = safeParseChatRequest(legacyRequest);
    expect(result.success).toBe(true);
  });

  it("should accept messages with tool invocation parts", () => {
    const toolRequest = {
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Search restaurants" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "search_documents",
              toolCallId: "call-123",
              state: "output-available",
              input: { query: "Italian" },
              output: { results: [] },
            },
          ],
        },
      ],
    };

    const result = safeParseChatRequest(toolRequest);
    expect(result.success).toBe(true);
  });

  it("should reject request without messages", () => {
    const invalidRequest = {};
    const result = safeParseChatRequest(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("should reject empty messages array", () => {
    const invalidRequest = { messages: [] };
    const result = safeParseChatRequest(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("should reject messages without user role", () => {
    const invalidRequest = {
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Hello",
        },
      ],
    };

    const result = safeParseChatRequest(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("user message");
    }
  });

  it("should reject invalid role", () => {
    const invalidRequest = {
      messages: [
        {
          id: "msg-1",
          role: "invalid-role",
          content: "Hello",
        },
      ],
    };

    const result = safeParseChatRequest(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("should reject invalid part type", () => {
    const invalidRequest = {
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [
            {
              type: "invalid-type",
              text: "Hello",
            },
          ],
        },
      ],
    };

    const result = safeParseChatRequest(invalidRequest);
    expect(result.success).toBe(false);
  });
});

