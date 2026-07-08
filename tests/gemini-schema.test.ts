import { describe, expect, it } from "vitest";

import { sanitizeGeminiResponseSchema } from "../src/lib/gemini-schema.js";
import { mauriBrainDumpJsonSchema } from "../src/schemas/extraction.js";
import { messageRouterExtractionJsonSchema } from "../src/schemas/message-router.js";

describe("sanitizeGeminiResponseSchema", () => {
  it("removes draft-07 metadata keys recursively", () => {
    const sanitized = sanitizeGeminiResponseSchema(mauriBrainDumpJsonSchema);

    expect(sanitized).not.toHaveProperty("$schema");
    expect(sanitized).not.toHaveProperty("title");
    expect(sanitized).toHaveProperty("type", "object");
    expect(sanitized).toHaveProperty("properties.finance");
  });

  it("preserves primitive schema values", () => {
    const sanitized = sanitizeGeminiResponseSchema({
      type: "string",
      enum: ["High", "Medium", "Low"]
    });

    expect(sanitized).toEqual({
      type: "string",
      enum: ["High", "Medium", "Low"]
    });
  });

  it("sanitizes message router extraction schema for Gemini", () => {
    const sanitized = sanitizeGeminiResponseSchema(messageRouterExtractionJsonSchema);

    expect(sanitized).toHaveProperty("type", "object");
    expect(sanitized).toHaveProperty("properties.intent");
    expect(sanitized).toHaveProperty("properties.profile_deltas");
  });
});
