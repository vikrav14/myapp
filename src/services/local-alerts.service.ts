import { supabase } from "../lib/supabase.js";
import type { LocalAlertType } from "../schemas/local-alert.js";
import { classifyLocalAlertArticle } from "./ai.service.js";
import {
  buildAlertFingerprint,
  scrapeAlertCandidates,
  type AlertCandidateArticle
} from "./local-alerts-scraper.service.js";

export interface LocalAlertRecord {
  id: string;
  fingerprint: string;
  alert_type: LocalAlertType;
  severity: string;
  title: string;
  summary: string;
  advice_text: string;
  source_name: string;
  source_url: string | null;
  published_at: string | null;
  status: string;
  created_at: string;
}

function mapAlert(row: Record<string, unknown>): LocalAlertRecord {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    alert_type: row.alert_type as LocalAlertType,
    severity: String(row.severity),
    title: String(row.title),
    summary: String(row.summary),
    advice_text: String(row.advice_text),
    source_name: String(row.source_name),
    source_url: row.source_url ? String(row.source_url) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    status: String(row.status),
    created_at: String(row.created_at)
  };
}

export async function ingestNewLocalAlerts(): Promise<{
  scanned: number;
  created: number;
  alerts: LocalAlertRecord[];
}> {
  const candidates = await scrapeAlertCandidates();
  const createdAlerts: LocalAlertRecord[] = [];

  for (const candidate of candidates) {
    const fingerprint = buildAlertFingerprint(candidate);
    const { data: existing } = await supabase
      .from("local_alerts")
      .select("id")
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    if (existing) {
      continue;
    }

    const classification = await classifyLocalAlertArticle({
      title: candidate.title,
      summary: candidate.summary,
      source: candidate.source,
      url: candidate.url,
      matchedKeywords: candidate.matchedKeywords
    });

    if (!classification.is_actionable_alert) {
      continue;
    }

    const publishedAt = candidate.publishedAt ? new Date(candidate.publishedAt) : null;
    const { data, error } = await supabase
      .from("local_alerts")
      .insert({
        fingerprint,
        alert_type: classification.alert_type,
        severity: classification.severity,
        title: classification.title,
        summary: classification.summary,
        advice_text: classification.advice_text,
        source_name: candidate.source,
        source_url: candidate.url,
        published_at: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null,
        raw_payload: {
          article: candidate,
          classification
        },
        status: "active"
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to store local alert: ${error.message}`);
    }

    createdAlerts.push(mapAlert(data as Record<string, unknown>));
  }

  return {
    scanned: candidates.length,
    created: createdAlerts.length,
    alerts: createdAlerts
  };
}

export function buildLocalAlertMessage(alert: LocalAlertRecord): string {
  const headings: Record<LocalAlertType, string> = {
    school_closure: "School alert",
    heavy_rain: "Heavy rain alert",
    cyclone: "Cyclone alert",
    flood: "Flood alert",
    traffic_disruption: "Traffic alert",
    general_advisory: "Local advisory"
  };

  const heading = headings[alert.alert_type];
  const sourceLine = alert.source_url ? `${alert.source_name} · ${alert.source_url}` : alert.source_name;

  return `🚨 Mauri alert — ${heading}

${alert.title}

${alert.summary}

What to do: ${alert.advice_text}

Source: ${sourceLine}

Reply alerts off to mute urgent pings.`;
}

export function shouldDeliverAlertToUser(input: {
  alertType: LocalAlertType;
  localAlertsEnabled: boolean;
  schoolAlertsEnabled: boolean;
}): boolean {
  if (!input.localAlertsEnabled) {
    return false;
  }

  if (input.alertType === "school_closure" && !input.schoolAlertsEnabled) {
    return false;
  }

  return true;
}

export async function markAlertDelivered(alertId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("local_alert_deliveries").insert({
    alert_id: alertId,
    user_id: userId
  });

  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to record local alert delivery: ${error.message}`);
  }
}

export async function getRecentLocalAlerts(limit = 5): Promise<LocalAlertRecord[]> {
  const { data, error } = await supabase
    .from("local_alerts")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load recent local alerts: ${error.message}`);
  }

  return (data ?? []).map((row) => mapAlert(row as Record<string, unknown>));
}
