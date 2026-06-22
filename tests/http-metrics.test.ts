import { beforeEach, describe, expect, it } from "vitest";

import {
  normalizeHttpPath,
  recordHttpRequest,
  renderHttpPrometheusMetrics,
  resetHttpMetricsForTests
} from "../src/lib/http-metrics.js";
import { renderPrometheusMetrics } from "../src/services/metrics.service.js";
import type { MetricsSnapshot } from "../src/types.js";

describe("http metrics", () => {
  beforeEach(() => {
    resetHttpMetricsForTests();
  });

  it("normalizes UUID path segments", () => {
    expect(
      normalizeHttpPath("/internal/admin/users/11111111-1111-4111-8111-111111111111")
    ).toBe("/internal/admin/users/:id");
  });

  it("records request counters and duration sums", () => {
    recordHttpRequest({
      method: "get",
      route: "/health",
      statusCode: 200,
      durationMs: 12
    });
    recordHttpRequest({
      method: "GET",
      route: "/health",
      statusCode: 200,
      durationMs: 8
    });

    const output = renderHttpPrometheusMetrics();
    expect(output).toContain('mauri_http_requests_total{method="GET",route="/health",status="200"} 2');
    expect(output).toContain('mauri_http_request_duration_ms_sum{method="GET",route="/health",status="200"} 20');
    expect(output).toContain('mauri_http_request_duration_ms_count{method="GET",route="/health",status="200"} 2');
  });

  it("appends HTTP metrics to the prometheus export", () => {
    recordHttpRequest({
      method: "POST",
      route: "/webhooks/whatsapp",
      statusCode: 200,
      durationMs: 25
    });

    const snapshot: MetricsSnapshot = {
      generated_at: "2026-06-22T00:00:00.000Z",
      uptime_seconds: 10,
      process_resident_memory_bytes: 1000,
      users_total: 1,
      users_trial_active: 0,
      users_paid_active: 1,
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
      audit_errors_24h: 0,
      inbound_duplicate_deliveries_24h: 0
    };

    const output = renderPrometheusMetrics(snapshot);
    expect(output).toContain("mauri_users_total 1");
    expect(output).toContain('mauri_http_requests_total{method="POST",route="/webhooks/whatsapp",status="200"} 1');
  });
});
