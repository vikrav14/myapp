import { describe, expect, it } from "vitest";

import {
  clampMauriReplyLength,
  finalizeMauriGeneratedReply,
  finalizeMauriTextReply,
  isEmotionalMessage,
  MAURI_ENGLISH_ONLY_LANGUAGE_RULE,
  MAURI_REPLY_MAX_WORDS,
  MAURI_REPLY_MAX_WORDS_EMOTIONAL,
  MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT,
  MAURI_TEXT_REPLY_GUARDRAILS
} from "../src/lib/mauri-voice.js";

describe("mauri voice rules", () => {
  it("requires English-only replies", () => {
    expect(MAURI_ENGLISH_ONLY_LANGUAGE_RULE).toContain("English only");
    expect(MAURI_ENGLISH_ONLY_LANGUAGE_RULE).toContain("Never use Mauritian Creole");
  });

  it("bundles language rule into text reply guardrails", () => {
    expect(MAURI_TEXT_REPLY_GUARDRAILS).toContain(MAURI_ENGLISH_ONLY_LANGUAGE_RULE);
    expect(MAURI_TEXT_REPLY_GUARDRAILS).toContain(`${MAURI_REPLY_MAX_WORDS} words`);
  });
});

describe("reply length guard", () => {
  it("detects emotional messages", () => {
    expect(isEmotionalMessage("I'm really stressed about exams")).toBe(true);
    expect(isEmotionalMessage("spent 150 on food")).toBe(false);
  });

  it("leaves short replies untouched", () => {
    expect(clampMauriReplyLength("Short and clear.", 120)).toBe("Short and clear.");
  });

  it("truncates long replies at a sentence boundary when possible", () => {
    const firstSentence = "This is the first sentence with enough words to matter.";
    const filler = Array.from({ length: 130 }, (_, index) => `word${index}`).join(" ");
    const reply = `${firstSentence} ${filler}`;

    const clamped = clampMauriReplyLength(reply, 20);
    expect(clamped).toBe(firstSentence);
    expect(clamped.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it("uses a higher limit for emotional messages", () => {
    const emotionalMessage = "I'm overwhelmed and anxious";
    const reply = Array.from({ length: MAURI_REPLY_MAX_WORDS + 10 }, () => "word").join(" ");

    const clamped = finalizeMauriTextReply({ message: emotionalMessage, reply });
    expect(clamped.split(/\s+/).length).toBeLessThanOrEqual(MAURI_REPLY_MAX_WORDS_EMOTIONAL);
  });

  it("supports explicit max word limits for generated copy", () => {
    const reply = Array.from({ length: MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT + 20 }, () => "word").join(" ");
    const clamped = finalizeMauriGeneratedReply({
      reply,
      maxWords: MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT
    });

    expect(clamped.split(/\s+/).length).toBeLessThanOrEqual(MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT);
  });
});
