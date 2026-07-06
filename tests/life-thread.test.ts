import { describe, expect, it } from "vitest";

import {
  buildHeavyShareLanePrompt,
  buildLifeThreadActivationNote,
  buildLifeThreadCandidatesFromFacts,
  isHeavyKnowYouShare
} from "../src/services/life-thread.service.js";
import type { UserMindFact } from "../src/types.js";

function fact(overrides: Partial<UserMindFact> & Pick<UserMindFact, "category" | "fact_value">): UserMindFact {
  return {
    id: "fact-1",
    user_id: "user-1",
    fact_key: "test",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
    ...overrides
  };
}

describe("life thread classification", () => {
  it("prioritises health waits over family care and caps at two threads", () => {
    const candidates = buildLifeThreadCandidatesFromFacts([
      fact({
        category: "relationships",
        fact_key: "wife",
        fact_value: "Jeshna — awaiting biopsy results"
      }),
      fact({
        category: "relationships",
        fact_key: "mum",
        fact_value: "Mum — not doing great"
      }),
      fact({
        category: "relationships",
        fact_key: "sister",
        fact_value: "Sister — family is a lot right now"
      }),
      fact({ category: "stressors", fact_key: "load", fact_value: "So much at once with family" })
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.kind).toBe("health_wait");
    expect(candidates[0]?.loopText).toContain("Jeshna");
    expect(candidates[1]?.kind).toBe("family_care");
    expect(candidates[1]?.offsetDays).toBeGreaterThan(candidates[0]!.offsetDays);
  });

  it("skips generic stressors that are not follow-up worthy", () => {
    const candidates = buildLifeThreadCandidatesFromFacts([
      fact({ category: "goals", fact_key: "app", fact_value: "Building a side app" }),
      fact({ category: "stressors", fact_key: "busy", fact_value: "Busy at work lately" })
    ]);

    expect(candidates).toHaveLength(0);
  });
});

describe("heavy know-you detection", () => {
  it("detects heavy shares from relationships and stressors", () => {
    expect(
      isHeavyKnowYouShare("Short message", [
        fact({ category: "stressors", fact_key: "health", fact_value: "Waiting on biopsy results" })
      ])
    ).toBe(true);
  });

  it("does not flag light profiles as heavy", () => {
    expect(
      isHeavyKnowYouShare("26, dev in Moka, gym", [
        fact({ category: "life_context", fact_key: "work", fact_value: "developer" })
      ])
    ).toBe(false);
  });
});

describe("life thread copy helpers", () => {
  it("builds a lane prompt that separates brief from personal context", () => {
    expect(buildHeavyShareLanePrompt("Vik")).toContain("morning brief");
    expect(buildHeavyShareLanePrompt("Vik")).toContain("separately");
  });

  it("builds activation notes for queued follow-ups", () => {
    expect(buildLifeThreadActivationNote([{ loop_text: "Jeshna — awaiting biopsy results" }])).toContain(
      "gentle check-in"
    );
    expect(
      buildLifeThreadActivationNote([
        { loop_text: "Jeshna — awaiting biopsy results" },
        { loop_text: "Mum — not doing great" }
      ])
    ).toContain("check-ins");
  });
});
