import { describe, expect, it } from "vitest";

import { buildChaosOrganizerMap, isChaosProfile } from "../src/services/chaos-organizer.service.js";
import { filterGroundedSemanticMemories, stripInboundBotEcho } from "../src/services/context-grounding.service.js";
import type { UserMindFact } from "../src/types.js";

function fact(overrides: Partial<UserMindFact> & Pick<UserMindFact, "category" | "fact_value">): UserMindFact {
  return {
    id: "fact-1",
    user_id: "user-1",
    fact_key: "test",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides
  };
}

describe("chaos organizer", () => {
  it("detects multi-stressor profiles", () => {
    expect(
      isChaosProfile([
        fact({ category: "stressors", fact_key: "rent", fact_value: "shop rent drowning me" }),
        fact({ category: "stressors", fact_key: "loan", fact_value: "uncle Rs 200000 loan" })
      ])
    ).toBe(true);
  });

  it("builds a short labeled map from facts", () => {
    const map = buildChaosOrganizerMap({
      firstName: "Vik",
      facts: [
        fact({ category: "stressors", fact_key: "rent", fact_value: "shop rent and tourism collapsed" }),
        fact({ category: "stressors", fact_key: "baby", fact_value: "new baby, no sleep" }),
        fact({ category: "relationships", fact_key: "uncle", fact_value: "uncle loan Rs 200000" }),
        fact({ category: "life_context", fact_key: "work", fact_value: "small retail shop in Grand Baie" })
      ]
    });

    expect(map).toContain("here's your map");
    expect(map).toContain("Money:");
    expect(map).toContain("Which line should we tackle first?");
    expect(map).not.toContain("loan shark");
  });
});

describe("context grounding", () => {
  it("drops contaminated semantic memories", () => {
    const facts = [fact({ category: "stressors", fact_key: "loan", fact_value: "uncle loan Rs 200000" })];
    const filtered = filterGroundedSemanticMemories(
      [
        {
          source: "conversation_memory",
          text: "Loan sharks threatened his relatives over crypto debts",
          similarity: 0.9,
          created_at: "2026-07-01T00:00:00.000Z",
          memory_type: "user_message"
        }
      ],
      facts
    );

    expect(filtered).toHaveLength(0);
  });

  it("strips echoed bot text and keeps the real question", () => {
    const botBody =
      "Vik, that's a seriously tough spot you're in right now. Dealing with a new baby, a shop struggling with rent.";
    const inbound = `${botBody}\n\nSo what do you suggest?`;

    expect(
      stripInboundBotEcho({
        message: inbound,
        recentAssistantBodies: [botBody]
      })
    ).toBe("So what do you suggest?");
  });
});
