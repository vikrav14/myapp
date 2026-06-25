import { describe, expect, it } from "vitest";

import {
  buildCustomSquadGoalSetReply,
  buildCustomSquadWeights,
  parseCustomSquadGoalBody,
  parseSquadGoalCommand,
  parseSquadPactFocusTokens,
  scoringWeightsForSquad
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
  weekly_pact_set_by: null,
  weekly_pact_weights: null
};

describe("parseSquadGoalCommand", () => {
  it("detects show, set, clear, and custom commands", () => {
    expect(parseSquadGoalCommand("squad goal")?.type).toBe("show");
    expect(parseSquadGoalCommand("squad goal study")?.type).toBe("set");
    expect(parseSquadGoalCommand("set squad goal save")?.pactKey).toBe("save");
    expect(parseSquadGoalCommand("squad goal clear")?.type).toBe("clear");
    expect(parseSquadGoalCommand("I spent 150 on food")).toBeNull();

    const custom = parseSquadGoalCommand("squad goal custom Exam cram — focus study todos");
    expect(custom?.type).toBe("setCustom");
    if (custom?.type === "setCustom") {
      expect(custom.label).toBe("Exam cram");
      expect(custom.focus).toEqual(["study", "todos"]);
    }
  });
});

describe("custom squad pact parsing", () => {
  it("parses focus tokens with aliases", () => {
    expect(parseSquadPactFocusTokens("study tasks spend")).toEqual(["study", "todos", "money"]);
  });

  it("rejects invalid custom bodies", () => {
    expect(parseCustomSquadGoalBody("Exam cram")).toBeNull();
    expect(parseCustomSquadGoalBody("X — focus study")).toBeNull();
  });

  it("merges custom focus into scoring weights", () => {
    const weights = buildCustomSquadWeights(["study", "money"]);
    expect(weights.studyHabitBonus).toBe(4);
    expect(weights.financeLog).toBe(3);
  });

  it("loads stored custom weights for scoreboard", () => {
    const squad: SquadRecord = {
      ...baseSquad,
      weekly_pact_key: "custom",
      weekly_pact_label: "Exam cram",
      weekly_pact_weights: {
        habitSuccess: 2,
        studyHabitBonus: 4,
        todoComplete: 5,
        financeLog: 3,
        focus: ["study", "todos", "money"]
      }
    };

    const weights = scoringWeightsForSquad(squad);
    expect(weights.todoComplete).toBe(5);
    expect(buildCustomSquadGoalSetReply(squad, {
      label: "Exam cram",
      focus: ["study", "todos", "money"],
      weights
    })).toContain("Exam cram");
  });
});

describe("scoreMemberLogs", () => {
  it("weights study pact toward study habits", async () => {
    const { scoreMemberLogs } = await import("../src/services/squad-pact.service.js");
    const weights = scoringWeightsForSquad({ weekly_pact_key: "study", weekly_pact_weights: null });
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
});

describe("squad pact copy", () => {
  it("builds preset showdown messages", async () => {
    const { buildSundayShowdownPactFooter, buildSquadCreatedPactHint, suggestedPactKeyForArchetype } =
      await import("../src/services/squad-pact.service.js");

    const studySquad = {
      ...baseSquad,
      weekly_pact_key: "study",
      weekly_pact_label: "Study sprint"
    };

    expect(buildSundayShowdownPactFooter(studySquad)).toContain("Study sprint");
    expect(buildSundayShowdownPactFooter(baseSquad)).toContain("custom");
    expect(suggestedPactKeyForArchetype("Student Grind")).toBe("study");
    expect(buildSquadCreatedPactHint("Student Grind")).toContain("squad goal study");
  });
});
