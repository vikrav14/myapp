import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { CuratedMorningBrief, DailyBriefRunRecord, DailyBriefRunStatus } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapRun(record: Record<string, unknown>): DailyBriefRunRecord {
  return {
    id: String(record.id),
    brief_date: String(record.brief_date),
    status: String(record.status),
    scrape_payload: isRecord(record.scrape_payload) ? record.scrape_payload : null,
    traffic_snapshot: isRecord(record.traffic_snapshot) ? record.traffic_snapshot : null,
    weather_snapshot: isRecord(record.weather_snapshot) ? record.weather_snapshot : null,
    curated_payload: isRecord(record.curated_payload) ? record.curated_payload : null,
    error_message: record.error_message ? String(record.error_message) : null,
    scraped_at: record.scraped_at ? String(record.scraped_at) : null,
    curated_at: record.curated_at ? String(record.curated_at) : null,
    delivered_at: record.delivered_at ? String(record.delivered_at) : null,
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export function getBriefDateInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function getDailyBriefRunByDate(briefDate: string): Promise<DailyBriefRunRecord | null> {
  const { data, error } = await supabase.from("daily_brief_runs").select("*").eq("brief_date", briefDate).maybeSingle();

  if (error) {
    throw new Error(`Failed to load daily brief run: ${error.message}`);
  }

  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function ensureDailyBriefRun(briefDate: string): Promise<DailyBriefRunRecord> {
  const existing = await getDailyBriefRunByDate(briefDate);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("daily_brief_runs")
    .insert({
      brief_date: briefDate,
      status: "pending_scrape"
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create daily brief run: ${error.message}`);
  }

  return mapRun(data as Record<string, unknown>);
}

export async function updateDailyBriefRun(
  runId: string,
  patch: Record<string, unknown>
): Promise<DailyBriefRunRecord> {
  const { data, error } = await supabase
    .from("daily_brief_runs")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("id", runId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update daily brief run: ${error.message}`);
  }

  return mapRun(data as Record<string, unknown>);
}

export async function markDailyBriefFailed(runId: string, message: string): Promise<DailyBriefRunRecord> {
  return updateDailyBriefRun(runId, {
    status: "failed",
    error_message: message
  });
}

export async function listDailyBriefRuns(limit: number): Promise<DailyBriefRunRecord[]> {
  const { data, error } = await supabase
    .from("daily_brief_runs")
    .select("*")
    .order("brief_date", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list daily brief runs: ${error.message}`);
  }

  return (data ?? []).map((row) => mapRun(row as Record<string, unknown>));
}

export function parseCuratedMorningBrief(payload: Record<string, unknown> | null): CuratedMorningBrief | null {
  if (!payload) {
    return null;
  }

  const stories = Array.isArray(payload.stories)
    ? payload.stories
        .filter(isRecord)
        .map((story) => ({
          topic: String(story.topic ?? "LocalBuzz"),
          headline: String(story.headline ?? ""),
          summary: String(story.summary ?? ""),
          source: String(story.source ?? "Mauri brief"),
          url: story.url ? String(story.url) : undefined
        }))
        .filter((story) => story.headline && story.summary)
    : [];

  return {
    brief_date: String(payload.brief_date ?? ""),
    weather_line: String(payload.weather_line ?? ""),
    traffic_line: String(payload.traffic_line ?? ""),
    stories
  };
}

export function todayBriefDate(): string {
  return getBriefDateInTimezone(env.MORNING_BRIEF_TIMEZONE);
}

/** Admin-only: allow scrape/curate/deliver to run again for today's brief. */
export async function resetDailyBriefRunForForceRerun(briefDate: string): Promise<DailyBriefRunRecord> {
  const run = await ensureDailyBriefRun(briefDate);
  return updateDailyBriefRun(run.id, {
    status: "pending_scrape",
    error_message: null
  });
}

export function isRunnableStatus(status: DailyBriefRunStatus | string, allowed: DailyBriefRunStatus[]): boolean {
  return allowed.includes(status as DailyBriefRunStatus);
}
