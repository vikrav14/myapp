import { describe, expect, it } from "vitest";

import {
  BRIEF_FOCUS_PRESET_LABELS,
  buildBriefFocusPrompt,
  displayPrimaryLaneLabel,
  parseBriefFocusSelection
} from "../src/services/brief-focus.service.js";

describe("brief focus", () => {
  it("builds a prompt asking for brief focus", () => {
    expect(buildBriefFocusPrompt("Vik")).toContain("7am brief focus");
    expect(buildBriefFocusPrompt("Vik")).toContain("Vik");
  });

  it("accepts preset labels and free text", () => {
    expect(parseBriefFocusSelection("Work & money")).toBe(BRIEF_FOCUS_PRESET_LABELS.work);
    expect(parseBriefFocusSelection("work and money")).toBe(BRIEF_FOCUS_PRESET_LABELS.work);
    expect(parseBriefFocusSelection("Work, side app, and family — no fluff")).toBe(
      "Work, side app, and family — no fluff"
    );
  });

  it("rejects too-short input", () => {
    expect(parseBriefFocusSelection("ok")).toBeNull();
    expect(parseBriefFocusSelection("  ")).toBeNull();
  });

  it("displays your own mix with brief focus when set", () => {
    expect(
      displayPrimaryLaneLabel({
        archetype: "Custom",
        brief_focus: "Work, side app, and family"
      })
    ).toBe("Your own mix — Work, side app, and family");

    expect(
      displayPrimaryLaneLabel({
        archetype: "Custom",
        brief_focus: null
      })
    ).toBe("Your own mix");

    expect(
      displayPrimaryLaneLabel({
        archetype: "Corporate / Career",
        brief_focus: null
      })
    ).toBe("Corporate / Career");
  });
});
