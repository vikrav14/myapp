import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();
const mockCountProactivePingsToday = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/outbound-pace.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/outbound-pace.service.js")>(
    "../src/services/outbound-pace.service.js"
  );

  return {
    ...actual,
    countProactivePingsToday: mockCountProactivePingsToday
  };
});

const {
  buildPostActivationPaceOffer,
  getDensityPromptBlock,
  handlePaceMessage,
  isPaceConfigured,
  parsePaceCommand,
  resolveNotificationConfig
} = await import("../src/services/notification-pace.service.js");
const { buildPacePickerInteractive, resolveInteractiveReplyId } = await import(
  "../src/services/whatsapp-interactive.service.js"
);

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  brief_focus: null,
  active_modules: [],
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2027-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"],
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
  help_focus_secondary: "discipline",
  notification_config: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("notification pace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountProactivePingsToday.mockResolvedValue(1);
  });

  it("parses pace commands", () => {
    expect(parsePaceCommand("my pace")).toEqual({ type: "show" });
    expect(parsePaceCommand("change rhythm")).toEqual({ type: "show" });
    expect(parsePaceCommand("pace steady")).toEqual({ type: "set", preset: "steady" });
    expect(parsePaceCommand("hello mauri")).toBeNull();
  });

  it("defaults unresolved users to bookends", () => {
    const config = resolveNotificationConfig(activeUser);
    expect(config.proactive_preset).toBe("bookends");
    expect(config.proactive_max_per_day).toBe(2);
    expect(config.density_profile).toBe("depth");
    expect(isPaceConfigured(activeUser)).toBe(false);
  });

  it("maps pace picker taps to explicit pace commands", () => {
    expect(resolveInteractiveReplyId("pace_coaching")).toBe("pace coaching");
    const picker = buildPacePickerInteractive({ firstName: "Ava", suggestedPreset: "bookends" });
    expect(picker.listButtonLabel).toBe("Pick pace");
    expect((picker.footer ?? "").length).toBeLessThanOrEqual(60);
    expect(picker.sections?.[0]?.rows?.some((row) => row.id === "pace_silent")).toBe(true);
  });

  it("shows pace status and picker for active users", async () => {
    const result = await handlePaceMessage({
      user: activeUser,
      message: "my pace"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Your Mauri pace");
    expect(result.reply).toContain("Today: 1/2");
    expect(result.interactive?.listButtonLabel).toBe("Pick pace");
  });

  it("persists explicit pace preset selection", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      notification_config: {
        proactive_preset: "silent",
        density_profile: "pulse",
        proactive_max_per_day: 0,
        proactive_min_interval_minutes: 0,
        proactive_max_per_week: 0,
        configured_at: "2026-06-22T12:00:00.000Z"
      }
    });

    const result = await handlePaceMessage({
      user: activeUser,
      message: "pace silent"
    });

    expect(mockUpdateUserState).toHaveBeenCalledWith(
      activeUser.id,
      expect.objectContaining({
        notification_config: expect.objectContaining({
          proactive_preset: "silent",
          configured_at: expect.any(String)
        })
      })
    );
    expect(result.reply).toContain("won't ping unprompted");
  });

  it("ignores non-pace messages during onboarding", async () => {
    const onboardingUser = {
      ...activeUser,
      onboarding_state: "awaiting_know_you" as const
    };

    const result = await handlePaceMessage({
      user: onboardingUser,
      message: "hello mauri"
    });

    expect(result.handled).toBe(false);
  });

  it("blocks pace commands until onboarding completes", async () => {
    const onboardingUser = {
      ...activeUser,
      onboarding_state: "awaiting_archetype" as const
    };

    const result = await handlePaceMessage({
      user: onboardingUser,
      message: "my pace"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Finish onboarding first");
  });

  it("offers post-activation pace picker only when unset", async () => {
    const offer = await buildPostActivationPaceOffer(activeUser);
    expect(offer?.reply).toContain("how often should I check in unprompted");
    expect(offer?.interactive?.listButtonLabel).toBe("Pick pace");

    const configured = await buildPostActivationPaceOffer({
      ...activeUser,
      notification_config: {
        proactive_preset: "steady",
        density_profile: "pulse",
        proactive_max_per_day: 4,
        proactive_min_interval_minutes: 180,
        proactive_max_per_week: 21,
        configured_at: "2026-06-22T12:00:00.000Z"
      }
    });
    expect(configured).toBeNull();
  });

  it("builds density prompt blocks from resolved pace", () => {
    expect(getDensityPromptBlock(activeUser)).toContain("Density: depth");

    const coachingUser = {
      ...activeUser,
      notification_config: {
        proactive_preset: "coaching" as const,
        density_profile: "micro" as const,
        proactive_max_per_day: 8,
        proactive_min_interval_minutes: 30,
        proactive_max_per_week: 42,
        configured_at: "2026-06-22T12:00:00.000Z"
      }
    };

    expect(getDensityPromptBlock(coachingUser)).toContain("Density: micro");
  });
});
