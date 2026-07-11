import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();
const mockSupabaseFrom = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom
  }
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { handleFinanceCommandMessage } = await import("../src/services/payday-runway.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2027-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"] as const,
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  payday_day_of_month: 25,
  monthly_income_rs: 25000,
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

function buildSelectChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: { data: unknown; error: null }) => void) =>
      resolve({ data: result.data ?? [], error: null }),
    configurable: true
  });
  return chain;
}

describe("handleFinanceCommandMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
  });

  it("sets payday day", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      payday_day_of_month: 28
    });

    const result = await handleFinanceCommandMessage({
      user: { ...activeUser, payday_day_of_month: null },
      message: "payday 28"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Payday set");
    expect(mockUpdateUserState).toHaveBeenCalledWith(activeUser.id, {
      payday_day_of_month: 28
    });
  });

  it("sets monthly income with dodo ack", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      monthly_income_rs: 25000
    });
    mockSupabaseFrom.mockImplementation(() =>
      buildSelectChain({
        data: []
      })
    );

    const result = await handleFinanceCommandMessage({
      user: activeUser,
      message: "salary 25000"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("🦤");
    expect(result.reply).toContain("monthly income saved");
  });

  it("shows runway using pay-cycle spend", async () => {
    mockSupabaseFrom.mockImplementation(() =>
      buildSelectChain({
        data: [
          { amount: 150, category: "Food" },
          { amount: 350, category: "Transport" }
        ]
      })
    );

    const result = await handleFinanceCommandMessage({
      user: activeUser,
      message: "my runway"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Payday runway");
    expect(result.reply).toContain("Rs 500");
  });

  it("ignores unrelated messages", async () => {
    const result = await handleFinanceCommandMessage({
      user: activeUser,
      message: "I spent 150 on mine frite"
    });

    expect(result.handled).toBe(false);
  });
});
