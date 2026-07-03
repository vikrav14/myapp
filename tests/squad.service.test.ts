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

vi.mock("../src/services/whatsapp.service.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined)
}));

const { parseSquadCommand, buildSquadInviteMessage, handleSquadMessage } = await import("../src/services/squad.service.js");
const { parseSquadGoalCommand } = await import("../src/services/squad-pact.service.js");

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
  subscription_ends_at: "2027-07-01T00:00:00.000Z",
  last_payment_at: "2026-06-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

const trialUser = {
  ...paidUser,
  subscription_status: "Trial_Active" as const,
  trial_started_at: "2026-06-01T00:00:00.000Z",
  trial_ends_at: "2027-07-01T00:00:00.000Z",
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null
};

describe("parseSquadCommand", () => {
  it("detects create, join, status, leave, and share commands", () => {
    expect(parseSquadCommand("create squad Study Crew")?.type).toBe("create");
    expect(parseSquadCommand("join ABC123")?.squadCode).toBe("ABC123");
    expect(parseSquadCommand("squad status")?.type).toBe("status");
    expect(parseSquadCommand("leave squad")?.type).toBe("leave");
    expect(parseSquadCommand("share squad")?.type).toBe("share");
    expect(parseSquadGoalCommand("squad goal hustle")?.pactKey).toBe("hustle");
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

  it("blocks squad commands for locked users", async () => {
    const result = await handleSquadMessage({
      user: {
        ...paidUser,
        subscription_status: "Locked"
      },
      message: "create squad"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("active trial or premium");
  });

  it("creates a squad for trial users", async () => {
    const createdSquad = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      squad_code: "A1B2C3",
      squad_name: "Study Crew",
      member_ids: [trialUser.id],
      weekly_pact_key: null,
      weekly_pact_label: null,
      weekly_pact_set_at: null,
      weekly_pact_set_by: null,
      created_at: "2026-06-22T00:00:00.000Z"
    };
    const pactSquad = {
      ...createdSquad,
      weekly_pact_key: "study",
      weekly_pact_label: "Study sprint",
      weekly_pact_set_at: "2026-06-22T12:00:00.000Z",
      weekly_pact_set_by: trialUser.id
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const insertSingle = vi.fn().mockResolvedValue({ data: createdSquad, error: null });
    const updateSingle = vi.fn().mockResolvedValue({ data: pactSquad, error: null });

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
              single: insertSingle
            })
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: updateSingle
              })
            })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await handleSquadMessage({
      user: trialUser,
      message: "create squad Study Crew"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("A1B2C3");
    expect(result.reply).toContain("Study sprint");
  });

  it("creates a squad for paid users", async () => {
    const createdSquad = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      squad_code: "A1B2C3",
      squad_name: "Study Crew",
      member_ids: [paidUser.id],
      weekly_pact_key: null,
      weekly_pact_label: null,
      weekly_pact_set_at: null,
      weekly_pact_set_by: null,
      created_at: "2026-06-22T00:00:00.000Z"
    };
    const pactSquad = {
      ...createdSquad,
      weekly_pact_key: "study",
      weekly_pact_label: "Study sprint",
      weekly_pact_set_at: "2026-06-22T12:00:00.000Z",
      weekly_pact_set_by: paidUser.id
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const insertSingle = vi.fn().mockResolvedValue({ data: createdSquad, error: null });
    const updateSingle = vi.fn().mockResolvedValue({ data: pactSquad, error: null });

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
              single: insertSingle
            })
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: updateSingle
              })
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
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "squad_pact_set"
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
        weekly_pact_key: null,
        weekly_pact_label: null,
        weekly_pact_set_at: null,
        weekly_pact_set_by: null,
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

  it("sets a weekly squad pact for members", async () => {
    const existingSquad = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      squad_code: "A1B2C3",
      squad_name: "Study Crew",
      member_ids: [paidUser.id],
      weekly_pact_key: null,
      weekly_pact_label: null,
      weekly_pact_set_at: null,
      weekly_pact_set_by: null,
      created_at: "2026-06-22T00:00:00.000Z"
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: existingSquad, error: null });
    const single = vi.fn().mockResolvedValue({
      data: {
        ...existingSquad,
        weekly_pact_key: "study",
        weekly_pact_label: "Study sprint",
        weekly_pact_set_at: "2026-06-22T12:00:00.000Z",
        weekly_pact_set_by: paidUser.id
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
          update: () => ({
            eq: () => ({
              select: () => ({
                single
              })
            })
          })
        };
      }

      if (table === "users") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await handleSquadMessage({
      user: paidUser,
      message: "squad goal study"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Study sprint");
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "squad_pact_set"
      })
    );
  });
});
