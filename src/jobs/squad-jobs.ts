import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { evaluateAndPersistOperationalAlerts } from "../services/alerting.service.js";
import { runOutboundMessageRetryLoop } from "../services/outbound-retry.service.js";
import { runSundayDiagnosticReports } from "../services/report.service.js";
import {
  buildSundayShowdownPactFooter,
  formatSquadPactLine,
  scoreMemberLogs,
  scoringWeightsForSquad
} from "../services/squad-pact.service.js";
import { listSquadEligibleMemberIds, type SquadRecord } from "../services/squad.service.js";
import { sendWhatsAppMessage } from "../services/whatsapp.service.js";

interface SquadMember {
  id: string;
  phone_number: string;
  first_name: string | null;
}

interface ScoreLine {
  member: SquadMember;
  score: number;
}

function mapSquadRow(record: Record<string, unknown>): SquadRecord {
  return {
    id: String(record.id),
    squad_code: String(record.squad_code),
    squad_name: String(record.squad_name),
    member_ids: Array.isArray(record.member_ids) ? record.member_ids.map(String) : [],
    created_at: String(record.created_at),
    weekly_pact_key: record.weekly_pact_key ? String(record.weekly_pact_key) : null,
    weekly_pact_label: record.weekly_pact_label ? String(record.weekly_pact_label) : null,
    weekly_pact_set_at: record.weekly_pact_set_at ? String(record.weekly_pact_set_at) : null,
    weekly_pact_set_by: record.weekly_pact_set_by ? String(record.weekly_pact_set_by) : null
  };
}

function startOfWindow(daysBack: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - daysBack);
  return now.toISOString();
}

function displayName(member: SquadMember): string {
  return member.first_name?.trim() || "Someone";
}

async function loadMembers(memberIds: string[]): Promise<SquadMember[]> {
  const { data, error } = await supabase.from("users").select("id, phone_number, first_name").in("id", memberIds);

  if (error) {
    throw new Error(`Failed to load squad members: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    phone_number: String(row.phone_number),
    first_name: row.first_name ? String(row.first_name) : null
  }));
}

async function scoreMembersForSquad(
  squad: SquadRecord,
  memberIds: string[],
  sinceIso: string
): Promise<Map<string, number>> {
  const weights = scoringWeightsForSquad(squad);
  const [habitResult, todoResult, financeResult] = await Promise.all([
    supabase
      .from("habit_logs")
      .select("user_id, activity_type, is_success")
      .in("user_id", memberIds)
      .gte("logged_at", sinceIso),
    supabase
      .from("todo_logs")
      .select("user_id")
      .in("user_id", memberIds)
      .eq("is_completed", true)
      .gte("completed_at", sinceIso),
    supabase
      .from("finance_logs")
      .select("user_id")
      .in("user_id", memberIds)
      .gte("logged_at", sinceIso)
  ]);

  const errors = [habitResult.error, todoResult.error, financeResult.error].filter(Boolean);
  if (errors.length) {
    throw new Error(errors.map((error) => error?.message).join("; "));
  }

  return scoreMemberLogs({
    memberIds,
    weights,
    habitRows: (habitResult.data ?? []).map((row) => ({
      user_id: String(row.user_id),
      activity_type: String(row.activity_type ?? ""),
      is_success: Boolean(row.is_success)
    })),
    todoRows: (todoResult.data ?? []).map((row) => ({
      user_id: String(row.user_id)
    })),
    financeRows: (financeResult.data ?? []).map((row) => ({
      user_id: String(row.user_id)
    }))
  });
}

async function buildRankings(
  squad: SquadRecord,
  memberIds: string[],
  daysBack: number
): Promise<ScoreLine[]> {
  const [members, scores] = await Promise.all([
    loadMembers(memberIds),
    scoreMembersForSquad(squad, memberIds, startOfWindow(daysBack))
  ]);

  return members
    .map((member) => ({
      member,
      score: scores.get(member.id) ?? 0
    }))
    .sort((left, right) => right.score - left.score);
}

export async function runCrossPrivateNudgeLoop(): Promise<void> {
  const { data: squads, error } = await supabase.from("squads").select("*");

  if (error) {
    throw new Error(`Failed to load squads for nudge loop: ${error.message}`);
  }

  for (const row of squads ?? []) {
    const squad = mapSquadRow(row as Record<string, unknown>);
    const memberIds = squad.member_ids;
    const eligibleMemberIds = await listSquadEligibleMemberIds(memberIds);
    if (eligibleMemberIds.length < 2) {
      continue;
    }

    const rankings = await buildRankings(squad, eligibleMemberIds, 3);
    const leader = rankings[0];
    if (!leader) {
      continue;
    }

    const laggers = rankings.filter((entry) => entry.score < leader.score - 1);
    const pactLine = formatSquadPactLine(squad);
    const pactTail = pactLine ? `\n\n${pactLine}` : "";

    for (const lagger of laggers) {
      const message = `${displayName(lagger.member)}, ${displayName(leader.member)} pe move in ${squad.squad_name}. You’re drifting a bit. Lock one win before tonight and drop it here.${pactTail}`;

      await sendWhatsAppMessage(lagger.member.phone_number, message, {
        userId: lagger.member.id,
        metadata: {
          flow: "squad_nudge",
          squadName: squad.squad_name,
          pactKey: squad.weekly_pact_key
        }
      });
    }
  }
}

export async function runSundayShowdown(): Promise<void> {
  const { data: squads, error } = await supabase.from("squads").select("*");

  if (error) {
    throw new Error(`Failed to load squads for Sunday showdown: ${error.message}`);
  }

  for (const row of squads ?? []) {
    const squad = mapSquadRow(row as Record<string, unknown>);
    const memberIds = squad.member_ids;
    const eligibleMemberIds = await listSquadEligibleMemberIds(memberIds);
    if (!eligibleMemberIds.length) {
      continue;
    }

    const rankings = await buildRankings(squad, eligibleMemberIds, 7);
    const scoreboard = rankings
      .map((entry, index) => `${index + 1}. ${displayName(entry.member)} — ${entry.score} pts`)
      .join("\n");

    const message = `Sunday showdown for ${squad.squad_name}.
${scoreboard}

${buildSundayShowdownPactFooter(squad)}

New week starts now. Send your first win when you’re ready.`;

    for (const entry of rankings) {
      await sendWhatsAppMessage(entry.member.phone_number, message, {
        userId: entry.member.id,
        metadata: {
          flow: "sunday_showdown",
          squadName: squad.squad_name,
          pactKey: squad.weekly_pact_key
        }
      });
    }
  }
}

export function registerSquadJobs(): void {
  cron.schedule(env.ALERT_EVALUATION_CRON, async () => {
    try {
      const alerts = await evaluateAndPersistOperationalAlerts();
      const openAlerts = alerts.filter((alert) => alert.status === "open").length;
      if (alerts.length > 0) {
        logger.info({ alertsEvaluated: alerts.length, openAlerts }, "Operational alerts evaluated.");
      }
    } catch (error) {
      logger.error({ error }, "Operational alert evaluation failed.");
    }
  });

  cron.schedule(env.OUTBOUND_RETRY_CRON, async () => {
    try {
      const result = await runOutboundMessageRetryLoop();
      if (result.scanned > 0) {
        logger.info(result, "Outbound retry loop completed.");
      }
    } catch (error) {
      logger.error({ error }, "Outbound retry loop failed.");
    }
  });

  cron.schedule("0 15 * * *", async () => {
    try {
      await runCrossPrivateNudgeLoop();
      logger.info("Cross-private nudge loop completed.");
    } catch (error) {
      logger.error({ error }, "Cross-private nudge loop failed.");
    }
  });

  cron.schedule("30 19 * * 0", async () => {
    try {
      const processed = await runSundayDiagnosticReports();
      logger.info({ processed }, "Sunday diagnostic reports completed.");
    } catch (error) {
      logger.error({ error }, "Sunday diagnostic reports failed.");
    }
  });

  cron.schedule("30 20 * * 0", async () => {
    try {
      await runSundayShowdown();
      logger.info("Sunday showdown completed.");
    } catch (error) {
      logger.error({ error }, "Sunday showdown failed.");
    }
  });
}
