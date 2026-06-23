import { describe, expect, it } from "vitest";

import {
  buildRelayNudgeMessage,
  extractionEarnsSquadPoints
} from "../src/services/squad-relay.service.js";

describe("squad relay", () => {
  it("detects scoring extractions", () => {
    expect(extractionEarnsSquadPoints({ finance: { amount: 100, category: "Food", raw_source_text: "lunch" } })).toBe(
      true
    );
    expect(
      extractionEarnsSquadPoints({
        habits: { activity_type: "Study_Deep_Work", is_success: true }
      })
    ).toBe(true);
    expect(
      extractionEarnsSquadPoints({
        habits: { activity_type: "Gym", is_success: false }
      })
    ).toBe(false);
    expect(extractionEarnsSquadPoints({ emotions: { anxiety_score: 4, raw_unfiltered_vent: "tired" } })).toBe(false);
  });

  it("builds a positive relay nudge", () => {
    const message = buildRelayNudgeMessage({
      laggerName: "Kim",
      leaderName: "Jay",
      squadName: "Study Crew",
      pactLine: "This week's pact: Study sprint — Study habits score extra."
    });

    expect(message).toContain("Jay just logged a win");
    expect(message).toContain("Your move");
    expect(message).not.toContain("drifting");
  });
});
