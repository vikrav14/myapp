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

const { parseSquadCommand, buildSquadInviteMessage, handleSquadMessage } = await import("../src/services/squad.service.js");

const paidUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Paid_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-01-08T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: "2026-06-01T00:00:00.000Z",
  subscription_ends_at: "2026-07-01T00:00:00.000Z",
  last_payment_at: "2026-06-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("parseSquadCommand", () => {
  it("detects create, join, status, leave, and share commands", () => {
    expect(parseSquadCommand("create squad Study Crew")?.type).toBe("create");
    expect(parseSquadCommand("join ABC123")?.squadCode).toBe("ABC123");
    expect(parseSquadCommand("squad status")?.type).toBe("status");
    expect(parseSquadCommand("leave squad")?.type).toBe("leave");
    expect(parseSquadCommand("share squad")?.type).toBe("share");
    expect(parseSquadCommand("I spent 150 on food")).toBeNull();
  });
});

describe("buildSquadInviteMessage", () => {
  it("builds a copy-paste WhatsApp invite", () => {
    const message = buildSquadInviteMessage({
      squad_name: "Study Crew",
      squad_code: "A1B2C3"
    });

    expect(message).toContain('Join my Mauri squad "Study Crew"');
    expect(message).toContain("join A1B2C3");
    expect(message).toContain("no group chat");
  });
});

describe("handleSquadMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
  });

  it("blocks squad commands for non-premium users", async () => {
    const result = await handleSquadMessage({
      user: {
        ...paidUser,
        subscription_status: "Trial_Active"
      },
      message: "create squad"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("premium feature");
  });

  it("creates a squad for paid users", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        squad_code: "A1B2C3",
        squad_name: "Study Crew",
        member_ids: [paidUser.id],
        created_at: "2026-06-22T00:00:00.000Z"
      },
      error: null
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "squads") {
        return {
          select: () => ({
            contains: () => ({
              maybeSingle
            })
          }),
          insert: () => ({
            select: () => ({
              single
            })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await handleSquadMessage({
      user: paidUser,
      message: "create squad Study Crew"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("A1B2C3");
    expect(result.reply).toContain("Copy and forward this invite");
    expect(result.reply).toContain('Join my Mauri squad "Study Crew"');
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "squad_created"
      })
    );
  });

  it("returns a shareable invite for squad members", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        squad_code: "A1B2C3",
        squad_name: "Study Crew",
        member_ids: [paidUser.id],
        created_at: "2026-06-22T00:00:00.000Z"
      },
      error: null
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "squads") {
        return {
          select: () => ({
            contains: () => ({
              maybeSingle
            })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await handleSquadMessage({
      user: paidUser,
      message: "share squad"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Share this invite");
    expect(result.reply).toContain("join A1B2C3");
  });
});
