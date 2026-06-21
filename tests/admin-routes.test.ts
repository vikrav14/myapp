import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAdminDashboardData = vi.fn();
const mockGetAdminOverview = vi.fn();
const mockGetAdminUserProfile = vi.fn();
const mockListAdminAuditEvents = vi.fn();
const mockListAdminDeadLetters = vi.fn();
const mockListAdminOutboundMessages = vi.fn();
const mockListAdminPaymentSessions = vi.fn();
const mockListAdminReports = vi.fn();
const mockListAdminUsers = vi.fn();
const mockAdminUpdateUser = vi.fn();
const mockRetryOutboundMessageById = vi.fn();
const mockUpdateDeadLetterStatus = vi.fn();
const mockGetOutboundMessageById = vi.fn();
const mockRequeueOutboundMessage = vi.fn();
const mockDiscardOutboundMessage = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/services/admin.service.js", () => ({
  adminUpdateUser: mockAdminUpdateUser,
  getAdminDashboardData: mockGetAdminDashboardData,
  getAdminOverview: mockGetAdminOverview,
  getAdminUserProfile: mockGetAdminUserProfile,
  listAdminAuditEvents: mockListAdminAuditEvents,
  listAdminDeadLetters: mockListAdminDeadLetters,
  listAdminOutboundMessages: mockListAdminOutboundMessages,
  listAdminPaymentSessions: mockListAdminPaymentSessions,
  listAdminReports: mockListAdminReports,
  listAdminUsers: mockListAdminUsers
}));

vi.mock("../src/services/outbound-retry.service.js", () => ({
  retryOutboundMessageById: mockRetryOutboundMessageById
}));

vi.mock("../src/services/dead-letter.service.js", () => ({
  updateDeadLetterStatus: mockUpdateDeadLetterStatus
}));

vi.mock("../src/services/outbound-message.service.js", () => ({
  getOutboundMessageById: mockGetOutboundMessageById,
  requeueOutboundMessage: mockRequeueOutboundMessage,
  discardOutboundMessage: mockDiscardOutboundMessage
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { createApp } = await import("../src/app.js");

describe("Admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the browser admin panel without requiring the admin key", async () => {
    const app = createApp();
    const response = await request(app).get("/internal/admin/panel");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Mauri Admin Panel");
    expect(response.text).toContain("Outbound queue");
  });

  it("rejects protected admin endpoints without the admin key", async () => {
    const app = createApp();
    const response = await request(app).get("/internal/admin/overview");

    expect(response.status).toBe(403);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toContain("Unauthorized");
    expect(mockGetAdminOverview).not.toHaveBeenCalled();
  });

  it("lists dead letters through the admin API", async () => {
    mockListAdminDeadLetters.mockResolvedValue({
      total: 1,
      deadLetters: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source_table: "outbound_messages",
          source_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          category: "outbound_message",
          status: "open",
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          request_id: "req-1",
          last_error: "Meta rate limited request",
          payload: { phoneNumber: "23050000000" },
          resolved_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ]
    });

    const app = createApp();
    const response = await request(app)
      .get("/internal/admin/dead-letters")
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.total).toBe(1);
    expect(response.body.deadLetters[0].category).toBe("outbound_message");
    expect(mockListAdminDeadLetters).toHaveBeenCalled();
  });

  it("returns the live security posture summary", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/internal/admin/security-posture")
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.securityPosture).toEqual(
      expect.objectContaining({
        securityHeadersEnabled: false,
        peachSignatureEnabled: true,
        outboundRetryEnabled: true
      })
    );
  });

  it("patches a user and records an admin audit event", async () => {
    mockAdminUpdateUser.mockResolvedValue({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      first_name: "Nia",
      archetype: "Student Grind",
      onboarding_state: "active",
      subscription_status: "Paid_Active"
    });

    const app = createApp();
    const response = await request(app)
      .patch("/internal/admin/users/ffffffff-ffff-4fff-8fff-ffffffffffff")
      .set("x-mauri-admin-key", "test-admin-key")
      .send({
        subscription_status: "Paid_Active"
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mockAdminUpdateUser).toHaveBeenCalledWith({
      userId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      updates: {
        subscription_status: "Paid_Active"
      }
    });
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin_user_updated",
        entityType: "user",
        entityId: "ffffffff-ffff-4fff-8fff-ffffffffffff"
      })
    );
  });

  it("requeues an outbound message and updates dead-letter state", async () => {
    const messageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    mockGetOutboundMessageById.mockResolvedValue({
      id: messageId,
      status: "permanent_failed",
      phone_number: "23058888888"
    });
    mockRequeueOutboundMessage.mockResolvedValue({
      id: messageId,
      status: "failed",
      phone_number: "23058888888"
    });
    mockUpdateDeadLetterStatus.mockResolvedValue({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      status: "requeued"
    });

    const app = createApp();
    const response = await request(app)
      .post(`/internal/admin/outbound-messages/${messageId}/requeue`)
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.result.status).toBe("failed");
    expect(mockGetOutboundMessageById).toHaveBeenCalledWith(messageId);
    expect(mockRequeueOutboundMessage).toHaveBeenCalledWith(messageId);
    expect(mockUpdateDeadLetterStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTable: "outbound_messages",
        sourceId: messageId,
        status: "requeued"
      })
    );
  });

  it("discards an outbound message and updates dead-letter state", async () => {
    const messageId = "abababab-abab-4bab-8bab-abababababab";

    mockGetOutboundMessageById.mockResolvedValue({
      id: messageId,
      status: "permanent_failed",
      phone_number: "23059999999"
    });
    mockDiscardOutboundMessage.mockResolvedValue({
      id: messageId,
      status: "discarded",
      phone_number: "23059999999"
    });
    mockUpdateDeadLetterStatus.mockResolvedValue({
      id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      status: "discarded"
    });

    const app = createApp();
    const response = await request(app)
      .post(`/internal/admin/outbound-messages/${messageId}/discard`)
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.message.status).toBe("discarded");
    expect(mockDiscardOutboundMessage).toHaveBeenCalledWith(messageId);
    expect(mockUpdateDeadLetterStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: messageId,
        status: "discarded"
      })
    );
  });
});
