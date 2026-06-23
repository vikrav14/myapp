import { describe, expect, it } from "vitest";

import {
  buildSquadGoalSetReply,
  buildSundayShowdownPactFooter,
  buildSquadCreatedPactHint,
  parseSquadGoalCommand,
  scoreMemberLogs,
  scoringWeightsForSquad,
  suggestedPactKeyForArchetype
} from "../src/services/squad-pact.service.js";
import type { SquadRecord } from "../src/services/squad.service.js";

const baseSquad: SquadRecord = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  squad_code: "A1B2C3",
  squad_name: "Study Crew",
  member_ids: ["11111111-1111-4111-8111-111111111111"],
  created_at: "2026-06-22T00:00:00.000Z",
  weekly_pact_key: null,
  weekly_pact_label: null,
  weekly_pact_set_at: null,
  weekly_pact_set_by: null
};

describe("parseSquadGoalCommand", () => {
  it("detects show, set, and clear commands", () => {
    expect(parseSquadGoalCommand("squad goal")?.type).toBe("show");
    expect(parseSquadGoalCommand("squad goal study")?.type).toBe("set");
    expect(parseSquadGoalCommand("set squad goal save")?.pactKey).toBe("save");
    expect(parseSquadGoalCommand("squad goal clear")?.type).toBe("clear");
    expect(parseSquadGoalCommand("I spent 150 on food")).toBeNull();
  });
});

describe("scoreMemberLogs", () => {
  it("weights study pact toward study habits", () => {
    const weights = scoringWeightsForSquad({ weekly_pact_key: "study" });
    const scores = scoreMemberLogs({
      memberIds: ["u1", "u2"],
      weights,
      habitRows: [
        { user_id: "u1", activity_type: "Study_Deep_Work", is_success: true },
        { user_id: "u2", activity_type: "Gym", is_success: true }
      ],
      todoRows: [],
      financeRows: []
    });

    expect(scores.get("u1")).toBe(6);
    expect(scores.get("u2")).toBe(2);
  });

  it("weights save pact toward finance logs", () => {
    const weights = scoringWeightsForSquad({ weekly_pact_key: "save" });
    const scores = scoreMemberLogs({
      memberIds: ["u1"],
      weights,
      habitRows: [],
      todoRows: [{ user_id: "u1" }],
      financeRows: [{ user_id: "u1" }, { user_id: "u1" }]
    });

    expect(scores.get("u1")).toBe(8);
  });
});

describe("squad pact copy", () => {
  it("builds set and showdown messages", () => {
    const studySquad = {
      ...baseSquad,
      weekly_pact_key: "study",
      weekly_pact_label: "Study sprint"
    };

    expect(buildSquadGoalSetReply(studySquad, { key: "study", label: "Study sprint", summary: "Study habits score extra." }))
      .toContain("Study sprint");
    expect(buildSundayShowdownPactFooter(studySquad)).toContain("Study sprint");
    expect(buildSundayShowdownPactFooter(baseSquad)).toContain("squad goal study");
  });

  it("suggests archetype-aligned pacts", () => {
    expect(suggestedPactKeyForArchetype("Student Grind")).toBe("study");
    expect(suggestedPactKeyForArchetype("Entrepreneur Mode")).toBe("hustle");
    expect(buildSquadCreatedPactHint("Student Grind")).toContain("squad goal study");
  });
});
