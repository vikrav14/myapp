import { describe, expect, it } from "vitest";

import {
  buildExpressActivationReply,
  buildExpressStartSummary,
  inferArchetypeFromFacts,
  inferExpressSetup,
  isExpressCardEchoMessage,
  isExpressSetupQuestion,
  isExpressStartConfirmation,
  buildExpressSetupQuestionReplyTemplate,
  shouldSuppressPostActivationNoise
} from "../src/services/express-onboarding.service.js";
import { inferHelpFocusFromFacts } from "../src/services/help-focus-inference.service.js";
import { suggestModulesFromFacts } from "../src/services/user-modules.service.js";
import { inferWeeklyFocusFromFacts } from "../src/services/weekly-focus.service.js";
import type { MauriUser, UserMindFact } from "../src/types.js";

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

  it("detects setup questions during express start", () => {
    expect(isExpressSetupQuestion("How do you know this or choose this for me?")).toBe(true);
    expect(isExpressSetupQuestion("why habits and founder")).toBe(true);
    expect(isExpressSetupQuestion("start my trial")).toBe(false);
  });

  it("explains setup choices from user facts in plain language", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "work", fact_value: "freelance logo design and airport transfers" }),
      fact({ category: "stressors", fact_key: "sleep", fact_value: "running on empty, no sleep" }),
      fact({ category: "stressors", fact_key: "money", fact_value: "MCB credit card maxed out" }),
      fact({ category: "location", fact_key: "area", fact_value: "Triolet" })
    ];
    const setup = inferExpressSetup(facts);
    const reply = buildExpressSetupQuestionReplyTemplate({ firstName: "Vik", setup, facts });

    expect(reply).toContain("Fair question");
    expect(reply).toContain("MCB");
    expect(reply).toContain("logo");
    expect(reply).not.toContain("Corporate / Career");
  });

  it("infers finance-first setup for retired elder with private savings tracking", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "age", fact_value: "64, retired primary school teacher in Rose Hill" }),
      fact({ category: "life_context", fact_key: "status", fact_value: "Widow, grieving" }),
      fact({
        category: "goals",
        fact_key: "granddaughter_tuition",
        fact_value: "Secret Rs 3,000/month for granddaughter tuition"
      }),
      fact({
        category: "stressors",
        fact_key: "family",
        fact_value: "Controlling son — potential family drama over helping granddaughter"
      }),
      fact({
        category: "goals",
        fact_key: "private_funds",
        fact_value: "Wants a private safe space to track my little funds"
      })
    ];

    const setup = inferExpressSetup(facts);

    expect(setup.archetype).toBe("Life & Habit Tracking");
    expect(setup.modules).toEqual(["career"]);
    expect(setup.morningPulseLabel).toBe("quiet money + local life");
    expect(setup.topics).toEqual(["LocalBuzz", "Money", "Traffic"]);
    expect(inferWeeklyFocusFromFacts(facts, setup.archetype)).toContain("private savings");
    expect(inferHelpFocusFromFacts(facts).primary).toBe("personal_finance");
    expect(inferHelpFocusFromFacts(facts).secondary).toBe("relationship");

    const activation = buildExpressActivationReply({
      firstName: "Vik",
      setup,
      weeklyFocus: inferWeeklyFocusFromFacts(facts, setup.archetype),
      facts
    });
    expect(activation).toContain("private money notes stay between us");
  });

  it("detects express card echo messages", () => {
    expect(
      isExpressCardEchoMessage(
        "Vik — here's what I'll set up for you:\n\nMorning pulse: balance + routines\nTags: #LocalBuzz #Money\nTap Start my trial below"
      )
    ).toBe(true);
    expect(isExpressCardEchoMessage("start my trial")).toBe(false);
  });

  it("suppresses post-activation noise within the quiet window", () => {
    const user = {
      onboarding_state: "active",
      onboarding_completed_at: new Date().toISOString()
    } as MauriUser;

    expect(shouldSuppressPostActivationNoise(user, "start my trial")).toBe(true);
    expect(shouldSuppressPostActivationNoise(user, "hey can you remind me tomorrow?")).toBe(false);
  });
});
