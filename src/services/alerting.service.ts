import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getSecurityPostureSummary } from "../lib/network-security.js";
import { supabase } from "../lib/supabase.js";
import type { MetricsSnapshot, OperationalAlertStateRecord } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { getMetricsSnapshot } from "./metrics.service.js";

interface AlertEvaluation {
  alertKey: string;
  severity: "warning" | "error";
  status: "open" | "closed";
  message: string;
  currentValue: number;
  thresholdValue: number;
  metadata?: Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapOperationalAlert(record: Record<string, unknown>): OperationalAlertStateRecord {
  return {
    id: String(record.id),
    alert_key: String(record.alert_key),
    severity: String(record.severity),
    status: String(record.status),
    message: String(record.message),
    current_value: record.current_value === null ? null : Number(record.current_value),
    threshold_value: record.threshold_value === null ? null : Number(record.threshold_value),
    metadata: isRecord(record.metadata) ? record.metadata : null,
    last_evaluated_at: String(record.last_evaluated_at),
    triggered_at: record.triggered_at ? String(record.triggered_at) : null,
    resolved_at: record.resolved_at ? String(record.resolved_at) : null,
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export function buildAlertEvaluations(snapshot: MetricsSnapshot): AlertEvaluation[] {
  const security = getSecurityPostureSummary();

  return [
    {
      alertKey: "outbound_pending_backlog",
      severity: "warning",
      status: snapshot.outbound_pending >= env.ALERT_OUTBOUND_PENDING_THRESHOLD ? "open" : "closed",
      message: "Outbound pending queue exceeded threshold.",
      currentValue: snapshot.outbound_pending,
      thresholdValue: env.ALERT_OUTBOUND_PENDING_THRESHOLD
    },
    {
      alertKey: "outbound_failed_backlog",
      severity: "error",
      status:
        snapshot.outbound_failed + snapshot.outbound_permanent_failed >= env.ALERT_OUTBOUND_FAILED_THRESHOLD
          ? "open"
          : "closed",
      message: "Failed outbound queue exceeded threshold.",
      currentValue: snapshot.outbound_failed + snapshot.outbound_permanent_failed,
      thresholdValue: env.ALERT_OUTBOUND_FAILED_THRESHOLD
    },
    {
      alertKey: "dead_letters_open",
      severity: "error",
      status: snapshot.dead_letters_open >= env.ALERT_OPEN_DEAD_LETTER_THRESHOLD ? "open" : "closed",
      message: "Open dead letters exceeded threshold.",
      currentValue: snapshot.dead_letters_open,
      thresholdValue: env.ALERT_OPEN_DEAD_LETTER_THRESHOLD
    },
    {
      alertKey: "security_posture_warnings",
      severity: "warning",
      status: security.warnings.length >= env.ALERT_SECURITY_WARNINGS_THRESHOLD ? "open" : "closed",
      message: "Security posture warnings exceeded threshold.",
      currentValue: security.warnings.length,
      thresholdValue: env.ALERT_SECURITY_WARNINGS_THRESHOLD,
      metadata: {
        warnings: security.warnings
      }
    },
    {
      alertKey: "audit_errors_24h",
      severity: "error",
      status: snapshot.audit_errors_24h >= env.ALERT_AUDIT_ERRORS_THRESHOLD ? "open" : "closed",
      message: "Error-severity audit events in the last 24 hours exceeded threshold.",
      currentValue: snapshot.audit_errors_24h,
      thresholdValue: env.ALERT_AUDIT_ERRORS_THRESHOLD
    },
    {
      alertKey: "inbound_duplicate_deliveries_24h",
      severity: "warning",
      status:
        snapshot.inbound_duplicate_deliveries_24h >= env.ALERT_INBOUND_DUPLICATE_DELIVERIES_THRESHOLD
          ? "open"
          : "closed",
      message: "Duplicate inbound webhook deliveries in the last 24 hours exceeded threshold.",
      currentValue: snapshot.inbound_duplicate_deliveries_24h,
      thresholdValue: env.ALERT_INBOUND_DUPLICATE_DELIVERIES_THRESHOLD
    }
  ];
}

async function notifyAlertWebhook(input: {
  event: "opened" | "resolved";
  evaluation: AlertEvaluation;
  record: OperationalAlertStateRecord;
  requestId?: string | undefined;
}): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) {
    return;
  }

  if (input.event === "resolved" && !env.ALERT_WEBHOOK_NOTIFY_ON_RESOLVE) {
    return;
  }

  const payload = {
    event: input.event,
    service: "mauri-backend",
    requestId: input.requestId ?? null,
    alert: {
      id: input.record.id,
      key: input.evaluation.alertKey,
      severity: input.evaluation.severity,
      status: input.record.status,
      message: input.evaluation.message,
      currentValue: input.evaluation.currentValue,
      thresholdValue: input.evaluation.thresholdValue,
      metadata: input.evaluation.metadata ?? input.record.metadata ?? null,
      triggeredAt: input.record.triggered_at,
      resolvedAt: input.record.resolved_at,
      evaluatedAt: input.record.last_evaluated_at
    }
  };

  try {
    const response = await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      logger.warn(
        {
          alertKey: input.evaluation.alertKey,
          event: input.event,
          statusCode: response.status
        },
        "Operational alert webhook notification failed."
      );
    }
  } catch (error) {
    logger.warn(
      {
        alertKey: input.evaluation.alertKey,
        event: input.event,
        error
      },
      "Operational alert webhook notification failed."
    );
  }
}

export async function listOperationalAlerts(status?: string): Promise<OperationalAlertStateRecord[]> {
  let query = supabase.from("operational_alert_states").select("*").order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list operational alerts: ${error.message}`);
  }

  return (data ?? []).map((row) => mapOperationalAlert(row as Record<string, unknown>));
}

export async function evaluateAndPersistOperationalAlerts(input?: {
  requestId?: string | undefined;
  snapshot?: MetricsSnapshot | undefined;
}): Promise<OperationalAlertStateRecord[]> {
  const snapshot = input?.snapshot ?? (await getMetricsSnapshot());
  const evaluations = buildAlertEvaluations(snapshot);
  const { data: existingRows, error: existingError } = await supabase.from("operational_alert_states").select("*");

  if (existingError) {
    throw new Error(`Failed to load existing operational alerts: ${existingError.message}`);
  }

  const existingMap = new Map(
    (existingRows ?? []).map((row) => [String(row.alert_key), mapOperationalAlert(row as Record<string, unknown>)])
  );
  const now = new Date().toISOString();

  const reconciled: OperationalAlertStateRecord[] = [];

  for (const evaluation of evaluations) {
    const existing = existingMap.get(evaluation.alertKey);
    const opening = evaluation.status === "open" && existing?.status !== "open";
    const resolving = evaluation.status === "closed" && existing?.status === "open";

    const { data, error } = await supabase
      .from("operational_alert_states")
      .upsert(
        {
          alert_key: evaluation.alertKey,
          severity: evaluation.severity,
          status: evaluation.status,
          message: evaluation.message,
          current_value: evaluation.currentValue,
          threshold_value: evaluation.thresholdValue,
          metadata: evaluation.metadata ?? null,
          last_evaluated_at: now,
          triggered_at: opening ? now : existing?.triggered_at ?? null,
          resolved_at: resolving ? now : evaluation.status === "open" ? null : existing?.resolved_at ?? null,
          updated_at: now
        },
        { onConflict: "alert_key" }
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to reconcile operational alert ${evaluation.alertKey}: ${error.message}`);
    }

    const record = mapOperationalAlert(data as Record<string, unknown>);
    reconciled.push(record);

    if (opening) {
      await recordAuditEventBestEffort({
        requestId: input?.requestId,
        eventType: "operational_alert_opened",
        severity: evaluation.severity,
        entityType: "operational_alert",
        entityId: record.id,
        message: evaluation.message,
        metadata: {
          alertKey: evaluation.alertKey,
          currentValue: evaluation.currentValue,
          thresholdValue: evaluation.thresholdValue
        }
      });
      await notifyAlertWebhook({
        event: "opened",
        evaluation,
        record,
        requestId: input?.requestId
      });
    }

    if (resolving) {
      await recordAuditEventBestEffort({
        requestId: input?.requestId,
        eventType: "operational_alert_resolved",
        severity: "info",
        entityType: "operational_alert",
        entityId: record.id,
        message: `Resolved: ${evaluation.message}`,
        metadata: {
          alertKey: evaluation.alertKey,
          currentValue: evaluation.currentValue,
          thresholdValue: evaluation.thresholdValue
        }
      });
      await notifyAlertWebhook({
        event: "resolved",
        evaluation,
        record,
        requestId: input?.requestId
      });
    }
  }

  return reconciled;
}
