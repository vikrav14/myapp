import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMetricsSnapshot = vi.fn();
const mockRenderPrometheusMetrics = vi.fn();
const mockEvaluateAndPersistOperationalAlerts = vi.fn();
const mockListOperationalAlerts = vi.fn();

vi.mock("../src/services/metrics.service.js", () => ({
  getMetricsSnapshot: mockGetMetricsSnapshot,
  renderPrometheusMetrics: mockRenderPrometheusMetrics
}));

vi.mock("../src/services/alerting.service.js", () => ({
  evaluateAndPersistOperationalAlerts: mockEvaluateAndPersistOperationalAlerts,
  listOperationalAlerts: mockListOperationalAlerts
}));

const { createApp } = await import("../src/app.js");

describe("monitoring routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves prometheus-style metrics text", async () => {
    mockGetMetricsSnapshot.mockResolvedValue({ users_total: 10 });
    mockRenderPrometheusMetrics.mockReturnValue("mauri_users_total 10\n");

    const app = createApp();
    const response = await request(app).get("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("mauri_users_total 10");
    expect(mockGetMetricsSnapshot).toHaveBeenCalled();
    expect(mockRenderPrometheusMetrics).toHaveBeenCalled();
  });

  it("lists operational alerts via admin API", async () => {
    mockListOperationalAlerts.mockResolvedValue([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        alert_key: "dead_letters_open",
        severity: "error",
        status: "open",
        message: "Open dead letters exceeded threshold."
      }
    ]);

    const app = createApp();
    const response = await request(app)
      .get("/internal/admin/alerts")
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.alerts[0].alert_key).toBe("dead_letters_open");
    expect(mockListOperationalAlerts).toHaveBeenCalledWith(undefined);
  });

  it("forces alert evaluation via admin API", async () => {
    mockEvaluateAndPersistOperationalAlerts.mockResolvedValue([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        alert_key: "outbound_pending_backlog",
        status: "open"
      }
    ]);

    const app = createApp();
    const response = await request(app)
      .post("/internal/admin/alerts/evaluate")
      .set("x-mauri-admin-key", "test-admin-key");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.alerts[0].alert_key).toBe("outbound_pending_backlog");
    expect(mockEvaluateAndPersistOperationalAlerts).toHaveBeenCalled();
  });
});
