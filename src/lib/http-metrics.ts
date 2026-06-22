import type { Request } from "express";

interface HttpMetricKey {
  method: string;
  route: string;
  status: string;
}

interface HttpMetricBucket {
  count: number;
  durationMsSum: number;
}

const httpMetricBuckets = new Map<string, HttpMetricBucket>();

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function bucketKey(input: HttpMetricKey): string {
  return `${input.method}|${input.route}|${input.status}`;
}

export function normalizeHttpPath(path: string): string {
  const pathname = path.split("?")[0]?.trim() || "unknown";
  return pathname.replace(UUID_PATTERN, ":id");
}

export function resolveHttpRoute(request: Request): string {
  if (request.route?.path) {
    const base = request.baseUrl || "";
    return normalizeHttpPath(`${base}${request.route.path}`);
  }

  return normalizeHttpPath(request.path || request.originalUrl || "unknown");
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const key = bucketKey({
    method: input.method.toUpperCase(),
    route: normalizeHttpPath(input.route),
    status: String(input.statusCode)
  });

  const current = httpMetricBuckets.get(key) ?? { count: 0, durationMsSum: 0 };
  current.count += 1;
  current.durationMsSum += Math.max(0, input.durationMs);
  httpMetricBuckets.set(key, current);
}

export function resetHttpMetricsForTests(): void {
  httpMetricBuckets.clear();
}

export function renderHttpPrometheusMetrics(): string {
  if (httpMetricBuckets.size === 0) {
    return "";
  }

  const lines = [
    "# HELP mauri_http_requests_total Total HTTP requests handled by the process",
    "# TYPE mauri_http_requests_total counter",
    "# HELP mauri_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds",
    "# TYPE mauri_http_request_duration_ms_sum counter",
    "# HELP mauri_http_request_duration_ms_count Count of HTTP requests included in duration sum",
    "# TYPE mauri_http_request_duration_ms_count counter"
  ];

  const sortedKeys = [...httpMetricBuckets.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [key, bucket] of sortedKeys) {
    const [method, route, status] = key.split("|") as [string, string, string];
    const labels = `method="${method}",route="${route}",status="${status}"`;
    lines.push(`mauri_http_requests_total{${labels}} ${bucket.count}`);
    lines.push(`mauri_http_request_duration_ms_sum{${labels}} ${bucket.durationMsSum}`);
    lines.push(`mauri_http_request_duration_ms_count{${labels}} ${bucket.count}`);
  }

  return `${lines.join("\n")}\n`;
}
