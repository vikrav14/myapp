import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseFrom = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom
  }
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { handleReminderMessage, buildReminderListReply, markReminderDelivered } = await import(
  "../src/services/reminder-schedule.service.js"
);

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
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

function buildSelectChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: result.data, error: result.error ?? null }));
  chain.maybeSingle = vi.fn(async () => ({ data: result.data, error: result.error ?? null }));
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: { data: unknown; error: null; count?: number }) => void) =>
      resolve({ data: result.data ?? [], error: null, count: result.count }),
    configurable: true
  });
  return chain;
}

describe("handleReminderMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
  });

  it("lists active reminders", async () => {
    mockSupabaseFrom.mockImplementation(() =>
      buildSelectChain({
        data: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            user_id: activeUser.id,
            label: "call mum",
            next_fire_at: "2026-06-23T14:00:00.000Z",
            repeat_kind: "once",
            repeat_hour: 18,
            repeat_minute: 0,
            repeat_weekdays: null,
            timezone: "Indian/Mauritius",
            status: "active",
            last_fired_at: null,
            created_at: "2026-06-22T00:00:00.000Z",
            updated_at: "2026-06-22T00:00:00.000Z"
          }
        ]
      })
    );

    const result = await handleReminderMessage({
      user: activeUser,
      message: "my reminders"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("call mum");
    expect(result.reply).toContain("cancel reminder 1");
  });

  it("creates a reminder", async () => {
    let call = 0;
    mockSupabaseFrom.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return buildSelectChain({ count: 0 });
      }

      return buildSelectChain({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          user_id: activeUser.id,
          label: "call mum",
          next_fire_at: "2026-06-23T14:00:00.000Z",
          repeat_kind: "once",
          repeat_hour: 18,
          repeat_minute: 0,
          repeat_weekdays: null,
          timezone: "Indian/Mauritius",
          status: "active",
          last_fired_at: null,
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-22T00:00:00.000Z"
        }
      });
    });

    const result = await handleReminderMessage({
      user: activeUser,
      message: "remind me to call mum at 6pm"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Reminder set");
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "reminder_created"
      })
    );
  });

  it("blocks locked users", async () => {
    const result = await handleReminderMessage({
      user: { ...activeUser, subscription_status: "Locked" },
      message: "my reminders"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("trial or subscription");
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it("ignores unrelated messages", async () => {
    const result = await handleReminderMessage({
      user: activeUser,
      message: "I spent 150 on mine frite"
    });

    expect(result.handled).toBe(false);
  });
});

describe("buildReminderListReply", () => {
  it("shows an empty-state prompt", () => {
    expect(buildReminderListReply([])).toContain("No active reminders");
  });
});

describe("markReminderDelivered", () => {
  it("keeps one-time reminders active until the user acknowledges", async () => {
    const reminder = {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: activeUser.id,
      label: "call mum",
      next_fire_at: "2026-06-23T14:00:00.000Z",
      repeat_kind: "once" as const,
      repeat_hour: 18,
      repeat_minute: 0,
      repeat_weekdays: null,
      timezone: "Indian/Mauritius",
      status: "active",
      last_fired_at: null,
      created_at: "2026-06-22T00:00:00.000Z",
      updated_at: "2026-06-22T00:00:00.000Z"
    };

    mockSupabaseFrom.mockImplementation(() =>
      buildSelectChain({
        data: {
          ...reminder,
          status: "active",
          last_fired_at: "2026-06-23T14:01:00.000Z",
          next_fire_at: "2099-01-01T00:00:00.000Z"
        }
      })
    );

    const updated = await markReminderDelivered(reminder);

    expect(updated.status).toBe("active");
    expect(updated.last_fired_at).toBeTruthy();
    expect(updated.next_fire_at).toBe("2099-01-01T00:00:00.000Z");
  });

  it("lets users mark a recently delivered reminder done", async () => {
    const reminder = {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: activeUser.id,
      label: "eat",
      next_fire_at: "2099-01-01T00:00:00.000Z",
      repeat_kind: "once" as const,
      repeat_hour: null,
      repeat_minute: null,
      repeat_weekdays: null,
      timezone: "Indian/Mauritius",
      status: "active",
      last_fired_at: new Date().toISOString(),
      created_at: "2026-06-22T00:00:00.000Z",
      updated_at: "2026-06-22T00:00:00.000Z"
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "scheduled_reminders") {
        return buildSelectChain({
          data: {
            ...reminder,
            status: "completed"
          }
        });
      }

      return buildSelectChain({ data: [] });
    });

    const result = await handleReminderMessage({
      user: activeUser,
      message: "done"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Done. "eat" is cleared.');
  });
});
