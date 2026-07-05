import { describe, expect, it } from "vitest";

import {
  MAURI_ENGLISH_ONLY_LANGUAGE_RULE,
  MAURI_TEXT_REPLY_GUARDRAILS
} from "../src/lib/mauri-voice.js";

describe("mauri voice rules", () => {
  it("requires English-only replies", () => {
    expect(MAURI_ENGLISH_ONLY_LANGUAGE_RULE).toContain("English only");
    expect(MAURI_ENGLISH_ONLY_LANGUAGE_RULE).toContain("Never use Mauritian Creole");
  });

  it("bundles language rule into text reply guardrails", () => {
    expect(MAURI_TEXT_REPLY_GUARDRAILS).toContain(MAURI_ENGLISH_ONLY_LANGUAGE_RULE);
  });
});
