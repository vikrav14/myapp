import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListAdminSquads = vi.fn();
const mockGetAdminSquadProfile = vi.fn();
const mockAdminUpdateSquad = vi.fn();
const mockAdminRemoveSquadMember = vi.fn();
const mockAdminDissolveSquad = vi.fn();
const mockGetAdminUserProfile = vi.fn();

vi.mock("../src/services/admin.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/admin.service.js")>();
  return {
    ...actual,
    listAdminSquads: mockListAdminSquads,
    getAdminSquadProfile: mockGetAdminSquadProfile,
    adminUpdateSquad: mockAdminUpdateSquad,
    adminRemoveSquadMember: mockAdminRemoveSquadMember,
    adminDissolveSquad: mockAdminDissolveSquad,
    getAdminUserProfile: mockGetAdminUserProfile
  };
});

const { createApp } = await import("../src/app.js");

const squadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Admin squad routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves squad management controls in the admin panel", async () => {
    const app = createApp();
    const response = await request(app).get("/internal/admin/panel");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Squads");
    expect(response.text).toContain('id="squadsTableBody"');
    expect(response.text).toContain('id="squadDetailContent"');
    expect(response.text).toContain("/internal/admin/squads");
    expect(response.text).toContain('id="copySquadInviteButton"');
    expect(response.text).toContain('id="squadInviteMessage"');
  });

  it("lists squads through the admin API", async () => {
    mockListAdminSquads.mockResolvedValue({
      total: 1,
      squads: [
        {
          id: squadId,
          squad_code: "ABC123",
          squad_name: "Study Crew",
          member_ids: [userId],
          created_at: "2026-01-01T00:00:00.000Z",
          memberCount: 1,
          paidMemberCount: 1
        }
      ]
    });

    const app = createApp();
    const response = await request(app)
      .get("/internal/admin/squads")
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.squads[0].squad_code).toBe("ABC123");
    expect(mockListAdminSquads).toHaveBeenCalled();
  });

  it("returns a squad profile with members", async () => {
    mockGetAdminSquadProfile.mockResolvedValue({
      squad: {
        id: squadId,
        squad_code: "ABC123",
        squad_name: "Study Crew",
        member_ids: [userId],
        created_at: "2026-01-01T00:00:00.000Z"
      },
      inviteMessage: 'Join my Mauri squad "Study Crew".\n\nOpen WhatsApp, message Mauri, and reply:\njoin ABC123',
      stats: {
        memberCount: 1,
        paidMemberCount: 1,
        nudgeEligible: false
      },
      members: [
        {
          user: {
            id: userId,
            phone_number: "23052525252",
            first_name: "Ava",
            subscription_status: "Paid_Active"
          },
          isPaidActive: true
        }
      ],
      recentAuditEvents: []
    });

    const app = createApp();
    const response = await request(app)
      .get(`/internal/admin/squads/${squadId}`)
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.profile.stats.memberCount).toBe(1);
    expect(response.body.profile.inviteMessage).toContain("join ABC123");
    expect(response.body.profile.members[0].user.first_name).toBe("Ava");
  });

  it("patches a squad name", async () => {
    mockAdminUpdateSquad.mockResolvedValue({
      id: squadId,
      squad_code: "ABC123",
      squad_name: "Night Grind",
      member_ids: [userId],
      created_at: "2026-01-01T00:00:00.000Z"
    });

    const app = createApp();
    const response = await request(app)
      .patch(`/internal/admin/squads/${squadId}`)
      .set("x-mauri-admin-key", "test-admin-key")
      .send({ squad_name: "Night Grind" });

    expect(response.status).toBe(200);
    expect(response.body.squad.squad_name).toBe("Night Grind");
    expect(mockAdminUpdateSquad).toHaveBeenCalledWith(
      expect.objectContaining({
        squadId,
        squadName: "Night Grind"
      })
    );
  });

  it("removes a squad member", async () => {
    mockAdminRemoveSquadMember.mockResolvedValue(null);

    const app = createApp();
    const response = await request(app)
      .delete(`/internal/admin/squads/${squadId}/members/${userId}`)
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mockAdminRemoveSquadMember).toHaveBeenCalledWith(
      expect.objectContaining({
        squadId,
        userId
      })
    );
  });

  it("dissolves a squad", async () => {
    mockAdminDissolveSquad.mockResolvedValue(undefined);

    const app = createApp();
    const response = await request(app)
      .delete(`/internal/admin/squads/${squadId}`)
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mockAdminDissolveSquad).toHaveBeenCalledWith(
      expect.objectContaining({
        squadId
      })
    );
  });
});
