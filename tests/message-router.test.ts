import { describe, expect, it } from "vitest";

import { parseMessageRouterExtraction } from "../src/schemas/message-router.js";
import {
  buildProfileDeltaAck,
  diffRouterExtractions,
  hasMaterialProfileDeltas,
  mergeStructuredExtractions,
  normalizeRouterExtraction,
  routerToStructuredExtraction
} from "../src/services/message-router.service.js";
import { profileDeltasToFactRows } from "../src/services/user-mind.service.js";

describe("message router schema", () => {
  it("parses a mixed extraction payload", () => {
    const parsed = parseMessageRouterExtraction(
      JSON.stringify({
        intent: "mixed",
        structured: {
          finance: {
            amount: 8000,
            category: "family",
            raw_source_text: "Paid Rs 8k to parents today"
          }
        },
        profile_deltas: [
          {
            category: "relationships",
            fact_key: "brother",
            fact_value: "Brother — contributing to wedding loan now"
          }
        ],
        confidence: "high"
      })
    );

    expect(parsed.intent).toBe("mixed");
    expect(parsed.structured?.finance?.amount).toBe(8000);
    expect(parsed.profile_deltas).toHaveLength(1);
  });
});

describe("message router helpers", () => {
  it("maps profile deltas to fact rows", () => {
    const rows = profileDeltasToFactRows([
      {
        category: "stressors",
        fact_key: "family_money",
        fact_value: "Brother is helping with installments now"
      }
    ]);

    expect(rows).toEqual([
      {
        category: "stressors",
        fact_key: "family_money",
        fact_value: "Brother is helping with installments now",
        source: "inferred"
      }
    ]);
  });

  it("builds ack for material stressor deltas", () => {
    expect(
      buildProfileDeltaAck([
        {
          category: "stressors",
          fact_key: "wedding_loan",
          fact_value: "Parents still expect payment"
        }
      ])
    ).toBe("Got it — updated how I read your money pressure.");
  });

  it("skips ack for non-material preference tweaks", () => {
    expect(
      buildProfileDeltaAck([
        {
          category: "preferences",
          fact_key: "tone",
          fact_value: "shorter replies please"
        }
      ])
    ).toBeNull();
  });

  it("detects material profile deltas", () => {
    expect(
      hasMaterialProfileDeltas([
        {
          category: "goals",
          fact_key: "side_hustle",
          fact_value: "digital marketing"
        }
      ])
    ).toBe(true);

    expect(
      hasMaterialProfileDeltas([
        {
          category: "preferences",
          fact_key: "tone",
          fact_value: "direct"
        }
      ])
    ).toBe(false);
  });

  it("strips writes on low confidence normalization", () => {
    const normalized = normalizeRouterExtraction({
      intent: "mixed",
      confidence: "low",
      structured: {
        finance: {
          amount: 100,
          category: "food",
          raw_source_text: "snack"
        }
      },
      profile_deltas: [
        {
          category: "goals",
          fact_key: "save",
          fact_value: "save more"
        }
      ]
    });

    expect(normalized).toEqual({
      intent: "chat_only",
      confidence: "low"
    });
  });

  it("merges structured extractions overlaying router fields onto legacy", () => {
    const legacy = {
      emotions: {
        anxiety_score: 3,
        raw_unfiltered_vent: "rough day"
      }
    };

    const router = {
      intent: "structured_log" as const,
      structured: {
        finance: {
          amount: 8000,
          category: "family",
          raw_source_text: "Paid Rs 8k to parents"
        }
      },
      confidence: "high" as const
    };

    const merged = mergeStructuredExtractions(legacy, router);

    expect(merged.finance?.amount).toBe(8000);
    expect(merged.emotions?.anxiety_score).toBe(3);
  });

  it("diffs legacy vs router extractions", () => {
    const diff = diffRouterExtractions({
      legacy: {
        finance: {
          amount: 8000,
          category: "family",
          raw_source_text: "Paid Rs 8k"
        }
      },
      router: {
        intent: "mixed",
        structured: {
          finance: {
            amount: 8000,
            category: "family",
            raw_source_text: "Paid Rs 8k"
          }
        },
        profile_deltas: [
          {
            category: "relationships",
            fact_key: "brother",
            fact_value: "helping with loan"
          }
        ]
      }
    });

    expect(diff).toContain("router_only:profile_delta.relationships.brother");
  });

  it("maps router structured output for commit writes", () => {
    const extraction = routerToStructuredExtraction({
      intent: "structured_log",
      structured: {
        finance: {
          amount: 8000,
          category: "family",
          raw_source_text: "Paid Rs 8k to parents"
        }
      },
      confidence: "high"
    });

    expect(extraction.finance?.amount).toBe(8000);
  });

  it("drops structured writes when router confidence is low", () => {
    const extraction = routerToStructuredExtraction({
      intent: "mixed",
      confidence: "low",
      structured: {
        finance: {
          amount: 100,
          category: "food",
          raw_source_text: "snack"
        }
      }
    });

    expect(extraction).toEqual({});
  });
});
