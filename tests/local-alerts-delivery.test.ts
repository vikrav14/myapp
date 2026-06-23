import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();
const mockGetRecentLocalAlerts = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/local-alerts.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/local-alerts.service.js")>(
    "../src/services/local-alerts.service.js"
  );

  return {
    ...actual,
    getRecentLocalAlerts: mockGetRecentLocalAlerts
  };
});

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { handleLocalAlertsCommandMessage, parseLocalAlertsCommand } = await import(
  "../src/services/local-alerts-delivery.service.js"
);
const { shouldDeliverAlertToUser } = await import("../src/services/local-alerts.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ravin",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"] as const,
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  local_alerts_enabled: true,
  school_alerts_enabled: true,
  payday_day_of_month: 25,
  monthly_income_rs: 25000,
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("parseLocalAlertsCommand", () => {
  it("parses alert toggles", () => {
    expect(parseLocalAlertsCommand("alerts off")).toEqual({ type: "alerts", enabled: false });
    expect(parseLocalAlertsCommand("school alerts on")).toEqual({ type: "school", enabled: true });
    expect(parseLocalAlertsCommand("my alerts")).toEqual({ type: "status" });
  });
});

describe("shouldDeliverAlertToUser", () => {
  it("skips school alerts when school alerts are off", () => {
    expect(
      shouldDeliverAlertToUser({
        alertType: "school_closure",
        localAlertsEnabled: true,
        schoolAlertsEnabled: false
      })
    ).toBe(false);

    expect(
      shouldDeliverAlertToUser({
        alertType: "heavy_rain",
        localAlertsEnabled: true,
        schoolAlertsEnabled: false
      })
    ).toBe(true);
  });
});

describe("handleLocalAlertsCommandMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
  });

  it("turns local alerts off", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      local_alerts_enabled: false
    });

    const result = await handleLocalAlertsCommandMessage({
      user: activeUser,
      message: "alerts off"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("off");
    expect(mockUpdateUserState).toHaveBeenCalledWith(activeUser.id, {
      local_alerts_enabled: false
    });
  });
});
