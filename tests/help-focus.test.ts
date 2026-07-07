import { describe, expect, it } from "vitest";

import {
  buildHelpFocusEnginePrompt,
  inferHelpFocusFromFacts,
  normalizeHelpFocusKey
} from "../src/services/help-focus-inference.service.js";
import { parseHelpFocusCommand } from "../src/services/help-focus.service.js";
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

describe("help focus inference", () => {
  it("infers finance and discipline for Vik-style shares", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({ category: "life_context", fact_key: "work", fact_value: "Painter struggling with money" }),
      fact({
        category: "goals",
        fact_key: "career",
        fact_value: "Considering a career change because I feel I have lost my way"
      }),
      fact({ category: "stressors", fact_key: "drinking", fact_value: "Drinking a lot lately" })
    ]);

    expect(inferred.primary).toBe("personal_finance");
    expect(["discipline", "self_help", "career"]).toContain(inferred.secondary);
  });

  it("normalizes labels and command phrases", () => {
    expect(normalizeHelpFocusKey("Personal Finance")).toBe("personal_finance");
    expect(parseHelpFocusCommand("help focus")).toEqual({ type: "show" });
    expect(parseHelpFocusCommand("help domain discipline")).toEqual({ type: "set", key: "discipline" });
  });

  it("builds compact engine prompt blocks", () => {
    const prompt = buildHelpFocusEnginePrompt({
      primary: "personal_finance",
      secondary: "discipline"
    });

    expect(prompt).toContain("Primary help focus: Personal Finance");
    expect(prompt).toContain("Secondary help focus: Discipline");
    expect(prompt).toContain("Never name-drop books");
  });

  it("prioritises finance and communication for family money pressure profiles", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({ category: "life_context", fact_key: "work", fact_value: "Remote developer in Tamarin for EU company" }),
      fact({
        category: "stressors",
        fact_key: "family",
        fact_value: "Family bleeding me dry — dad expects me to cover brother's loans"
      }),
      fact({ category: "goals", fact_key: "boundaries", fact_value: "Build boundaries with family" })
    ]);

    expect(inferred.primary).toBe("personal_finance");
    expect(["communication", "relationship"]).toContain(inferred.secondary);
  });
});
