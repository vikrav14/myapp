import { describe, expect, it } from "vitest";

import {
  formatFreshContextForPrompt,
  formatSemanticMemoriesForPrompt
} from "../src/services/context-prompt.service.js";
import {
  isEmotionalMessage,
  shouldSkipStructuredExtraction
} from "../src/services/message-intent.service.js";

describe("message-intent.service", () => {
  it("detects emotional messages", () => {
    expect(isEmotionalMessage("Exams next week and I'm not ready. Can't focus.")).toBe(true);
    expect(isEmotionalMessage("Mo stress la, pas kapav dormi.")).toBe(true);
    expect(isEmotionalMessage("What's a good study technique?")).toBe(false);
  });

  it("skips structured extraction for obvious general Q&A", () => {
    expect(shouldSkipStructuredExtraction("What's a good study technique?")).toBe(true);
    expect(shouldSkipStructuredExtraction("How do I revise faster?")).toBe(true);
    expect(shouldSkipStructuredExtraction("Spent too much this weekend. Can I go out Friday?")).toBe(false);
    expect(shouldSkipStructuredExtraction("Exams next week and I'm not ready.")).toBe(false);
  });
});

describe("context-prompt.service", () => {
  it("formats fresh context as prose instead of raw JSON", () => {
    const formatted = formatFreshContextForPrompt({
      pendingTodos: [
        {
          id: "1",
          task_description: "Finish assignment",
          priority: "High",
          due_date: "2026-06-25T00:00:00.000Z"
        }
      ],
      recentFinance: [{ amount: 150, category: "Food", logged_at: "2026-06-22T10:00:00.000Z" }],
      recentHabits: [
        {
          activity_type: "Study_Deep_Work",
          is_success: true,
          duration_minutes: 90,
          logged_at: "2026-06-22T08:00:00.000Z"
        }
      ],
      recentEmotions: [],
      semanticMemories: [],
      userMind: null,
      userMindGeneratedAt: null,
      paydayRunwaySnippet: "Payday in 3d — ~Rs 1200 breathing room at this pace."
    });

    expect(formatted).toContain("Finish assignment");
    expect(formatted).toContain("Payday in 3d");
    expect(formatted).toContain("Rs 150 Food");
    expect(formatted).not.toContain("[{");
  });

  it("formats semantic memories compactly", () => {
    const formatted = formatSemanticMemoriesForPrompt([
      {
        source: "conversation_memory",
        text: "User mentioned a job interview on Tuesday.",
        similarity: 0.82,
        created_at: "2026-06-20T00:00:00.000Z",
        memory_type: "user_message",
        metadata: null
      }
    ]);

    expect(formatted).toContain("job interview");
    expect(formatted).not.toContain("similarity");
  });
});
