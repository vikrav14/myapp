import { env } from "../lib/env.js";
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

function buildAlertEvaluations(snapshot: MetricsSnapshot): AlertEvaluation[] {
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
    }
  ];
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
    }
  }

  return reconciled;
}
