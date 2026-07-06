import { describe, expect, it } from "vitest";

import {
  finalizeOnboardingModules,
  hasModule,
  parseModuleToggleCommand,
  parseOnboardingModuleSelection,
  suggestModulesFromFacts
} from "../src/services/user-modules.service.js";
import type { UserMindFact } from "../src/types.js";

describe("user modules", () => {
  it("suggests career + habits for corporate user with heavy load", () => {
    const facts: UserMindFact[] = [
      {
        id: "1",
        user_id: "u1",
        category: "relationships",
        fact_key: "wife",
        fact_value: "Jeshna — awaiting biopsy",
        source: "onboarding",
        confidence: 1,
        user_visible: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      }
    ];

    expect(suggestModulesFromFacts(facts, "Corporate / Career")).toEqual(["career", "habits"]);
  });

  it("merges primary default when user picks an extra module", () => {
    expect(finalizeOnboardingModules(["habits"], "Corporate / Career")).toEqual(["career", "habits"]);
  });

  it("parses onboarding module text selections", () => {
    expect(parseOnboardingModuleSelection({ message: "modules suggested", primaryLane: "Corporate / Career", facts: [] })).toEqual([
      "career",
      "habits"
    ]);
    expect(parseOnboardingModuleSelection({ message: "career habits", primaryLane: "Corporate / Career", facts: [] })).toEqual([
      "career",
      "habits"
    ]);
  });

  it("blocks brief-only for custom lane", () => {
    expect(
      parseOnboardingModuleSelection({ message: "modules none", primaryLane: "Custom", facts: [] })
    ).toBe("invalid_custom");
  });

  it("parses add/remove module commands", () => {
    expect(parseModuleToggleCommand("add habits")).toEqual({ action: "add", module: "habits" });
    expect(parseModuleToggleCommand("remove founder")).toEqual({ action: "remove", module: "founder" });
  });

  it("checks module membership", () => {
    expect(hasModule({ active_modules: ["career", "habits"] }, "career")).toBe(true);
    expect(hasModule({ active_modules: ["career"] }, "student")).toBe(false);
  });
});
