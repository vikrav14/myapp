import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSecurityPostureSummary = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

const mockUpsert = vi.fn();
const mockSelect = vi.fn();
const mockSingle = vi.fn();

vi.mock("../src/lib/env.js", () => ({
  env: {
    ALERT_OUTBOUND_PENDING_THRESHOLD: 25,
    ALERT_OUTBOUND_FAILED_THRESHOLD: 10,
    ALERT_OPEN_DEAD_LETTER_THRESHOLD: 5,
    ALERT_SECURITY_WARNINGS_THRESHOLD: 1,
    ALERT_AUDIT_ERRORS_THRESHOLD: 5,
    ALERT_INBOUND_DUPLICATE_DELIVERIES_THRESHOLD: 10,
    ALERT_WEBHOOK_URL: "https://hooks.example.com/alerts",
    ALERT_WEBHOOK_NOTIFY_ON_RESOLVE: false
  }
}));

vi.mock("../src/lib/network-security.js", () => ({
  getSecurityPostureSummary: mockGetSecurityPostureSummary
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert
    }))
  }
}));

const { buildAlertEvaluations, evaluateAndPersistOperationalAlerts } = await import("../src/services/alerting.service.js");

describe("alerting service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityPostureSummary.mockReturnValue({ warnings: [] });
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
    mockSelect.mockResolvedValue({ data: [], error: null });
    mockUpsert.mockReturnValue({
      select: () => ({
        single: mockSingle
      })
    });
    mockSingle.mockImplementation(async () => ({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        alert_key: "audit_errors_24h",
        severity: "error",
        status: "open",
        message: "Error-severity audit events in the last 24 hours exceeded threshold.",
        current_value: 7,
        threshold_value: 5,
        metadata: null,
        last_evaluated_at: "2026-06-22T00:00:00.000Z",
        triggered_at: "2026-06-22T00:00:00.000Z",
        resolved_at: null,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      },
      error: null
    }));
  });

  it("builds alert evaluations including audit and duplicate inbound thresholds", () => {
    const evaluations = buildAlertEvaluations({
      generated_at: "2026-06-22T00:00:00.000Z",
      uptime_seconds: 10,
      process_resident_memory_bytes: 1000,
      users_total: 1,
      users_trial_active: 1,
      users_paid_active: 0,
      users_locked: 0,
      users_awaiting_archetype: 0,
      outbound_pending: 0,
      outbound_failed: 0,
      outbound_permanent_failed: 0,
      dead_letters_open: 0,
      alerts_open: 0,
      payments_24h: 0,
      reports_24h: 0,
      voice_notes_24h: 0,
      audit_errors_24h: 7,
      inbound_duplicate_deliveries_24h: 12
    });

    expect(evaluations.find((item) => item.alertKey === "audit_errors_24h")?.status).toBe("open");
    expect(evaluations.find((item) => item.alertKey === "inbound_duplicate_deliveries_24h")?.status).toBe("open");
  });

  it("posts webhook notifications when an alert opens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await evaluateAndPersistOperationalAlerts({
      requestId: "req-1",
      snapshot: {
        generated_at: "2026-06-22T00:00:00.000Z",
        uptime_seconds: 10,
        process_resident_memory_bytes: 1000,
        users_total: 1,
        users_trial_active: 1,
        users_paid_active: 0,
        users_locked: 0,
        users_awaiting_archetype: 0,
        outbound_pending: 0,
        outbound_failed: 0,
        outbound_permanent_failed: 0,
        dead_letters_open: 0,
        alerts_open: 0,
        payments_24h: 0,
        reports_24h: 0,
        voice_notes_24h: 0,
        audit_errors_24h: 7,
        inbound_duplicate_deliveries_24h: 12
      }
    });

    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.event).toBe("opened");
    expect(body.requestId).toBe("req-1");
    expect(body.alert.key).toBe("audit_errors_24h");

    vi.unstubAllGlobals();
  });
});
