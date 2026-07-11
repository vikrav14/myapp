import { describe, expect, it } from "vitest";

import {
  applyCaptureAckToReply,
  buildMeasurableLogAckLine,
  buildPlaybookCatalogPrompt,
  buildRememberFactAck,
  buildStrategicTransparencyPromptBlock,
  buildUnifiedCaptureAck,
  classifyFinanceCapture,
  ensureMauriDodoOnAdviceReply,
  extractionHasReportableData,
  isAdviceSeekingMessage,
  isSubstantiveComplaint,
  prependMeasurableAckIfMissing,
  resolveStrategicTransparencyMode
} from "../src/lib/strategic-transparency.js";
import type { MauriUser } from "../src/types.js";

function user(overrides: Partial<MauriUser> = {}): MauriUser {
  return {
    id: "user-1",
    phone_number: "+23050000000",
    first_name: "Vik",
    archetype: "Hustler",
    onboarding_state: "active",
    subscription_status: "trial",
    help_focus_primary: "personal_finance",
    help_focus_secondary: "discipline",
    active_modules: [],
    ...overrides
  } as MauriUser;
}

describe("strategic transparency", () => {
  it("detects advice-seeking and substantive complaints", () => {
    expect(isAdviceSeekingMessage("What should I do about rent?")).toBe(true);
    expect(isAdviceSeekingMessage("spent 200 on food")).toBe(false);
    expect(isSubstantiveComplaint("Boss keeps piling work and I'm exhausted")).toBe(true);
    expect(isSubstantiveComplaint("rough day")).toBe(false);
  });

  it("builds playbook catalog from user lanes", () => {
    const catalog = buildPlaybookCatalogPrompt({
      primary: "personal_finance",
      secondary: "discipline"
    });

    expect(catalog).toContain("Psychology of Money");
    expect(catalog).toContain("personal finance (primary)");
    expect(catalog).toContain("discipline (secondary)");
  });

  it("uses lens mode for complaints and tactical for advice", () => {
    expect(
      resolveStrategicTransparencyMode({
        message: "Can't afford rent and mum keeps calling",
        hasPlaybookLane: true,
        chaosMode: false
      })
    ).toBe("lens");

    expect(
      resolveStrategicTransparencyMode({
        message: "What should I do about payday?",
        hasPlaybookLane: true,
        chaosMode: false
      })
    ).toBe("tactical");

    expect(
      resolveStrategicTransparencyMode({
        message: "spent 200 on groceries",
        hasPlaybookLane: true,
        chaosMode: false,
        extraction: {
          finance: { amount: 200, category: "groceries", raw_source_text: "spent 200 on groceries" }
        }
      })
    ).toBe("none");
  });

  it("includes strategic transparency block when lane is set", () => {
    const { block, mode } = buildStrategicTransparencyPromptBlock({
      user: user(),
      message: "I'm stressed about money before payday",
      chaosMode: false
    });

    expect(mode).toBe("lens");
    expect(block).toContain("Playbook lens");
    expect(block).toContain("Psychology of Money");
    expect(block).toContain("🦤");
  });

  it("skips strategic block in chaos mode", () => {
    const { block, mode } = buildStrategicTransparencyPromptBlock({
      user: user(),
      message: "Everything is on fire",
      chaosMode: true
    });

    expect(mode).toBe("none");
    expect(block).toBe("");
  });

  it("builds measurable log ack lines with dodo", () => {
    expect(
      buildMeasurableLogAckLine({
        finance: { amount: 150, category: "food", raw_source_text: "spent 150" }
      })
    ).toBe("🦤 Got it — Rs 150 on food logged.");

    expect(
      buildMeasurableLogAckLine({
        finance: { amount: 25000, category: "salary", raw_source_text: "salary 25000" }
      })
    ).toBe("🦤 Got it — Rs 25000 income logged.");

    expect(
      buildMeasurableLogAckLine({
        finance: { amount: 8000, category: "rent", raw_source_text: "rent is 8000" }
      })
    ).toBe("🦤 Got it — Rs 8000 fixed cost (rent) logged.");

    expect(
      buildMeasurableLogAckLine({
        habits: { activity_type: "gym", is_success: true }
      })
    ).toBe("🦤 Nice — gym logged.");

    expect(extractionHasReportableData({ finance: { amount: 1, category: "x", raw_source_text: "x" } })).toBe(
      true
    );

    expect(classifyFinanceCapture({ amount: 25000, category: "salary", raw_source_text: "earn 25000" })).toBe(
      "income"
    );
  });

  it("merges measurable and profile capture into one dodo line", () => {
    expect(
      buildUnifiedCaptureAck({
        extraction: {
          finance: { amount: 4000, category: "car declaration", raw_source_text: "log expense 4000 declaration of car" }
        },
        profileDeltas: [
          {
            category: "life_context",
            fact_key: "work",
            fact_value: "commute to Grand Baie"
          }
        ]
      })
    ).toBe(
      "🦤 Got it — Rs 4000 on car declaration logged, and updated what you're working toward."
    );
  });

  it("builds remember-that ack with dodo", () => {
    expect(buildRememberFactAck("I live in Quatre Bornes")).toContain("🦤 Got it — saved for your profile:");
  });

  it("prepends measurable ack when model omits it", () => {
    const reply = prependMeasurableAckIfMissing("Keep an eye on food spend this week.", {
      finance: { amount: 200, category: "groceries", raw_source_text: "spent 200" }
    });

    expect(reply).toMatch(/^🦤 Got it — Rs 200 on groceries logged\./);
    expect(reply).toContain("Keep an eye on food spend");
  });

  it("ensures dodo on advice when missing", () => {
    expect(ensureMauriDodoOnAdviceReply("Try one runway number before the 15th.", true)).toBe(
      "🦤 Try one runway number before the 15th."
    );
    expect(ensureMauriDodoOnAdviceReply("🦤 Already marked.", true)).toBe("🦤 Already marked.");
    expect(ensureMauriDodoOnAdviceReply("Plain chat.", false)).toBe("Plain chat.");
  });
});
