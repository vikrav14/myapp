import { describe, expect, it } from "vitest";

import { buildInteractiveDeliveryFallback } from "../src/services/whatsapp.service.js";
import { buildHelpFocusPickerInteractive } from "../src/services/whatsapp-interactive.service.js";

describe("interactive delivery fallback", () => {
  it("returns help focus status text when the list fails to deliver", () => {
    const fallback = buildInteractiveDeliveryFallback({
      flow: "help_focus",
      payload: {
        text: "Vik — I'm leaning into Personal Finance for advice.",
        interactive: buildHelpFocusPickerInteractive({
          firstName: "Vik",
          suggestedPrimary: "personal_finance",
          suggestedSecondary: "relationship"
        })
      }
    });

    expect(fallback).toContain("Personal Finance");
    expect(fallback).toContain("help domain");
    expect(fallback).not.toContain("Reply help focus to confirm or change your advice lane.");
  });

  it("uses a short nudge when text was already sent", () => {
    const fallback = buildInteractiveDeliveryFallback({
      flow: "help_focus",
      textAlreadySent: true,
      payload: {
        text: "Already sent",
        interactive: buildHelpFocusPickerInteractive({ firstName: "Vik" })
      }
    });

    expect(fallback).toContain("help domain");
    expect(fallback).not.toContain("Already sent");
  });

  it("uses activation-specific nudge when express text was already sent", () => {
    const fallback = buildInteractiveDeliveryFallback({
      flow: "express_activation",
      textAlreadySent: true,
      payload: {
        text: "Already sent",
        interactive: buildHelpFocusPickerInteractive({ firstName: "Vik" })
      }
    });

    expect(fallback).toContain("help focus confirm");
    expect(fallback).toContain("my playbook");
    expect(fallback).not.toContain("Already sent");
  });
});
