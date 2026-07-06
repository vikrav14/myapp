import { describe, expect, it } from "vitest";

import {
  buildExpressStartSummary,
  inferArchetypeFromFacts,
  inferExpressSetup,
  isExpressStartConfirmation
} from "../src/services/express-onboarding.service.js";
import { suggestModulesFromFacts } from "../src/services/user-modules.service.js";
import type { UserMindFact } from "../src/types.js";

function fact(overrides: Partial<UserMindFact> & Pick<UserMindFact, "category" | "fact_value">): UserMindFact {
  return {
    id: "fact-1",
    user_id: "user-1",
    fact_key: "test",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("express onboarding", () => {
  it("infers corporate setup for finance commuter profile", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "work", fact_value: "working in finance in Ébène" }),
      fact({ category: "stressors", fact_key: "commute", fact_value: "2 hours in traffic daily from Flic-en-Flac" }),
      fact({
        category: "goals",
        fact_key: "daughter_uni",
        fact_value: "Saving for daughter's university in the UK next year"
      })
    ];

    const setup = inferExpressSetup(facts);

    expect(setup.archetype).toBe("Corporate / Career");
    expect(setup.modules).toEqual(["career", "habits"]);
    expect(setup.morningPulseLabel).toContain("money");
    expect(setup.topics).toEqual(["Traffic", "Tech", "Money"]);
  });

  it("does not suggest student tools for a parent's daughter university goal", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "work", fact_value: "finance manager in Ebene" }),
      fact({
        category: "goals",
        fact_key: "daughter",
        fact_value: "Saving for daughter's university in the UK"
      })
    ];

    expect(suggestModulesFromFacts(facts, "Corporate / Career")).toEqual(["career", "habits"]);
  });

  it("infers student grind for self-student profiles", () => {
    expect(
      inferArchetypeFromFacts([
        fact({ category: "life_context", fact_key: "study", fact_value: "Final year student at UoM" })
      ])
    ).toBe("Student Grind");
  });

  it("builds express start summary with setup preview", () => {
    const setup = inferExpressSetup([
      fact({ category: "life_context", fact_key: "work", fact_value: "printing shop owner in Beau Bassin" })
    ]);

    const summary = buildExpressStartSummary({ firstName: "Ravin", setup });
    expect(summary).toContain("Morning pulse");
    expect(summary).toContain("next step");
    expect(summary).toContain("Start my trial");
  });

  it("accepts start confirmations", () => {
    expect(isExpressStartConfirmation("start my trial")).toBe(true);
    expect(isExpressStartConfirmation("OK")).toBe(true);
    expect(isExpressStartConfirmation("maybe later")).toBe(false);
  });
});
