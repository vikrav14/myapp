import { describe, expect, it } from "vitest";

import {
  buildHelpFocusActivationExplanation,
  buildHelpFocusEnginePrompt,
  buildHelpFocusSourcesReply,
  inferHelpFocusFromFacts,
  normalizeHelpFocusKey,
  parseHelpFocusSourcesRequest
} from "../src/services/help-focus-inference.service.js";
import { parseHelpFocusCommand, handleHelpFocusMessage } from "../src/services/help-focus.service.js";
import {
  buildHelpFocusActivationInteractive,
  buildHelpFocusPickerInteractive,
  buildHelpFocusPickerRows,
  resolveInteractiveReplyId,
  WHATSAPP_LIST_MAX_ROWS
} from "../src/services/whatsapp-interactive.service.js";
import type { UserMindFact } from "../src/types.js";

function fact(overrides: Partial<UserMindFact> & Pick<UserMindFact, "category" | "fact_value">): UserMindFact {
  return {
    id: "fact-1",
    user_id: "user-1",
    fact_key: "test",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
    ...overrides
  };
}

describe("help focus inference", () => {
  it("infers finance and discipline for Vik-style shares", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({ category: "life_context", fact_key: "work", fact_value: "Painter struggling with money" }),
      fact({
        category: "goals",
        fact_key: "career",
        fact_value: "Considering a career change because I feel I have lost my way"
      }),
      fact({ category: "stressors", fact_key: "drinking", fact_value: "Drinking a lot lately" })
    ]);

    expect(inferred.primary).toBe("personal_finance");
    expect(["discipline", "self_help", "career"]).toContain(inferred.secondary);
  });

  it("normalizes labels and command phrases", () => {
    expect(normalizeHelpFocusKey("Personal Finance")).toBe("personal_finance");
    expect(normalizeHelpFocusKey("Psychology")).toBe("psychology");
    expect(normalizeHelpFocusKey("Art")).toBe("art");
    expect(parseHelpFocusCommand("help focus confirm")).toEqual({ type: "confirm" });
    expect(parseHelpFocusCommand("help focus")).toEqual({ type: "show" });
    expect(parseHelpFocusCommand("change your advice lane")).toEqual({ type: "show" });
    expect(parseHelpFocusCommand("help domain discipline")).toEqual({ type: "set", key: "discipline" });
    expect(parseHelpFocusCommand("help domain psychology")).toEqual({ type: "set", key: "psychology" });
    expect(parseHelpFocusCommand("help domain art")).toEqual({ type: "set", key: "art" });
  });

  it("infers psychology for therapy-adjacent shares", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({
        category: "stressors",
        fact_key: "anxiety",
        fact_value: "Panic attacks before work — rumination all night"
      })
    ]);

    expect(inferred.primary).toBe("psychology");
  });

  it("infers art for creative practice shares", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({
        category: "goals",
        fact_key: "creative",
        fact_value: "Building a painting portfolio after shop hours"
      })
    ]);

    expect(["art", "business"]).toContain(inferred.primary);
    expect(inferred.primary === "art" || inferred.secondary === "art").toBe(true);
  });

  it("builds compact engine prompt blocks", () => {
    const prompt = buildHelpFocusEnginePrompt({
      primary: "personal_finance",
      secondary: "discipline"
    });

    expect(prompt).toContain("Primary help focus: Personal Finance");
    expect(prompt).toContain("Secondary help focus: Discipline");
    expect(prompt).toContain("Never name-drop books unless the user asked for sources");
  });

  it("reveals playbook copy when the user asks", () => {
    const reply = buildHelpFocusSourcesReply({
      firstName: "Vik",
      primary: "personal_finance",
      secondary: "psychology"
    });

    expect(reply).toContain("your playbook");
    expect(reply).toContain("What I'm applying for you");
    expect(reply).toContain("Runway clarity without shame");
    expect(reply).toContain("Psychology of Money");
    expect(reply).toContain("What to expect:");
    expect(reply).toContain("(primary)");
    expect(reply).toContain("(secondary)");
    expect(reply).toContain("Not homework");

    expect(parseHelpFocusSourcesRequest("my playbook")).toEqual({ lane: null });
    expect(parseHelpFocusSourcesRequest("my playbook psychology")).toEqual({ lane: "psychology" });
    expect(parseHelpFocusSourcesRequest("help focus sources")).toEqual({ lane: null });
    expect(parseHelpFocusSourcesRequest("help focus sources psychology")).toEqual({ lane: "psychology" });
    expect(parseHelpFocusSourcesRequest("which book is that from")).toEqual({ lane: null });
    expect(parseHelpFocusSourcesRequest("help focus sources widgets")).toEqual({
      lane: null,
      invalidLane: "widgets"
    });
    expect(parseHelpFocusSourcesRequest("help focus personal finance")).toBeNull();
  });

  it("prioritises finance and communication for family money pressure profiles", () => {
    const inferred = inferHelpFocusFromFacts([
      fact({ category: "life_context", fact_key: "work", fact_value: "Remote developer in Tamarin for EU company" }),
      fact({
        category: "stressors",
        fact_key: "family",
        fact_value: "Family bleeding me dry — dad expects me to cover brother's loans"
      }),
      fact({ category: "goals", fact_key: "boundaries", fact_value: "Build boundaries with family" })
    ]);

    expect(inferred.primary).toBe("personal_finance");
    expect(["communication", "relationship"]).toContain(inferred.secondary);
  });

  it("explains help focus rationale without repeating labels in activation picker", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "work", fact_value: "Remote dev in Tamarin" }),
      fact({
        category: "stressors",
        fact_key: "brother",
        fact_value: "Primary carer for brother with severe special needs"
      }),
      fact({
        category: "stressors",
        fact_key: "money",
        fact_value: "Good salary but bank account stays flat — family bleeding me dry"
      })
    ];

    const explanation = buildHelpFocusActivationExplanation({
      primary: "personal_finance",
      secondary: "parenting",
      facts
    });

    expect(explanation).toContain("Personal Finance + Parenting");
    expect(explanation).toContain("🛡️ Strategy track");
    expect(explanation).toContain("How I help:");
    expect(explanation).not.toContain("Classic frameworks woven in");
    expect(explanation).not.toContain("Psychology of Money");

    expect(explanation).toContain("Next message");
    expect(explanation).toContain("Looks good, Pick lane, or My playbook");
    expect(explanation).toContain("My playbook");

    const activationButtons = buildHelpFocusActivationInteractive({ firstName: "Vik" });
    expect(activationButtons.buttons?.[0]?.title).toBe("Looks good");
    expect(activationButtons.buttons?.[1]?.title).toBe("Pick lane");
    expect(activationButtons.buttons?.[2]?.title).toBe("My playbook");

    const picker = buildHelpFocusPickerInteractive({
      firstName: "Vik",
      suggestedPrimary: "personal_finance",
      suggestedSecondary: "parenting",
      variant: "activation"
    });

    expect(picker.body).toContain("confirm or switch");
    expect(picker.body).not.toContain("Personal Finance");
    expect(picker.body).not.toContain("Parenting");

    const rows = buildHelpFocusPickerRows({
      suggestedPrimary: "personal_finance",
      suggestedSecondary: "parenting"
    });
    expect(rows.length).toBeLessThanOrEqual(WHATSAPP_LIST_MAX_ROWS);
    expect(rows.some((row) => row.id === "help_domain_personal_finance")).toBe(true);
    expect(rows.some((row) => row.id === "help_domain_parenting")).toBe(true);
  });
});

describe("help focus activation playbook UX", () => {
  it("maps My playbook button tap to my playbook command", () => {
    expect(resolveInteractiveReplyId("help_playbook")).toBe("my playbook");
  });

  it("re-shows activation buttons after playbook during fresh activation", async () => {
    const result = await handleHelpFocusMessage({
      user: {
        id: "u1",
        phone_number: "23050000000",
        first_name: "Vik",
        archetype: "Corporate / Career",
        brief_focus: null,
        active_modules: [],
        onboarding_state: "active",
        subscription_status: "Trial_Active",
        onboarding_completed_at: new Date().toISOString(),
        trial_started_at: new Date().toISOString(),
        trial_ends_at: null,
        locked_at: null,
        subscription_started_at: null,
        subscription_ends_at: null,
        last_payment_at: null,
        topic_preferences: [],
        morning_digest_enabled: true,
        calendar_sync_enabled: true,
        memory_resurfacing_enabled: true,
        local_alerts_enabled: true,
        school_alerts_enabled: true,
        payday_day_of_month: null,
        monthly_income_rs: null,
        weekly_focus_habit: null,
        weekly_focus_set_at: null,
        open_loop_followups_enabled: true,
        proactive_checkins_paused_until: null,
        quiet_hours_enabled: true,
        quiet_hours_start_hour: 22,
        quiet_hours_end_hour: 7,
        help_focus_primary: "personal_finance",
        help_focus_secondary: "relationship",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      message: "my playbook"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("your playbook");
    expect(result.reply).toContain("Tap Looks good to lock this lane");
    expect(result.interactive?.buttons?.map((button) => button.title)).toEqual([
      "Looks good",
      "Pick lane",
      "My playbook"
    ]);
  });
});
