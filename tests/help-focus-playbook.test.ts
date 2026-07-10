import { describe, expect, it } from "vitest";

import { HELP_FOCUS_PLAYBOOK } from "../src/services/help-focus-playbook.js";
import { HELP_FOCUS_KEYS } from "../src/services/help-focus.constants.js";

describe("help focus playbook", () => {
  it("defines outcome-first copy for every advice lane", () => {
    for (const key of HELP_FOCUS_KEYS) {
      const lane = HELP_FOCUS_PLAYBOOK[key];
      expect(lane.items.length).toBeGreaterThanOrEqual(3);
      expect(lane.whatToExpect.length).toBeGreaterThan(10);
      for (const item of lane.items) {
        expect(item.outcome.length).toBeGreaterThan(5);
        expect(item.source.length).toBeGreaterThan(2);
      }
    }
  });
});
