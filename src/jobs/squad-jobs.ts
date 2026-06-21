import cron from "node-cron";

import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
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

async function scoreMembers(memberIds: string[], sinceIso: string): Promise<Map<string, number>> {
  const [habitResult, todoResult, financeResult] = await Promise.all([
    supabase
      .from("habit_logs")
      .select("user_id, is_success")
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

  const scores = new Map<string, number>();

  for (const memberId of memberIds) {
    scores.set(memberId, 0);
  }

  for (const row of habitResult.data ?? []) {
    const delta = row.is_success ? 2 : 0;
    scores.set(String(row.user_id), (scores.get(String(row.user_id)) ?? 0) + delta);
  }

  for (const row of todoResult.data ?? []) {
    scores.set(String(row.user_id), (scores.get(String(row.user_id)) ?? 0) + 3);
  }

  for (const row of financeResult.data ?? []) {
    scores.set(String(row.user_id), (scores.get(String(row.user_id)) ?? 0) + 1);
  }

  return scores;
}

async function buildRankings(memberIds: string[], daysBack: number): Promise<ScoreLine[]> {
  const [members, scores] = await Promise.all([loadMembers(memberIds), scoreMembers(memberIds, startOfWindow(daysBack))]);

  return members
    .map((member) => ({
      member,
      score: scores.get(member.id) ?? 0
    }))
    .sort((left, right) => right.score - left.score);
}

export async function runCrossPrivateNudgeLoop(): Promise<void> {
  const { data: squads, error } = await supabase.from("squads").select("id, squad_name, member_ids");

  if (error) {
    throw new Error(`Failed to load squads for nudge loop: ${error.message}`);
  }

  for (const squad of squads ?? []) {
    const memberIds = Array.isArray(squad.member_ids) ? squad.member_ids.map(String) : [];
    if (memberIds.length < 2) {
      continue;
    }

    const rankings = await buildRankings(memberIds, 3);
    const leader = rankings[0];
    if (!leader) {
      continue;
    }

    const laggers = rankings.filter((entry) => entry.score < leader.score - 1);

    for (const lagger of laggers) {
      const message = `${displayName(lagger.member)}, ${displayName(leader.member)} pe move in ${String(
        squad.squad_name
      )}. You’re drifting a bit. Lock one win before tonight and drop it here.`;

      await sendWhatsAppMessage(lagger.member.phone_number, message);
    }
  }
}

export async function runSundayShowdown(): Promise<void> {
  const { data: squads, error } = await supabase.from("squads").select("id, squad_name, member_ids");

  if (error) {
    throw new Error(`Failed to load squads for Sunday showdown: ${error.message}`);
  }

  for (const squad of squads ?? []) {
    const memberIds = Array.isArray(squad.member_ids) ? squad.member_ids.map(String) : [];
    if (!memberIds.length) {
      continue;
    }

    const rankings = await buildRankings(memberIds, 7);
    const scoreboard = rankings
      .map((entry, index) => `${index + 1}. ${displayName(entry.member)} — ${entry.score} pts`)
      .join("\n");

    const message = `Sunday showdown for ${String(
      squad.squad_name
    )}.\n${scoreboard}\n\nNew week starts now. Send your first win when you’re ready.`;

    for (const entry of rankings) {
      await sendWhatsAppMessage(entry.member.phone_number, message);
    }
  }
}

export function registerSquadJobs(): void {
  cron.schedule("0 15 * * *", async () => {
    try {
      await runCrossPrivateNudgeLoop();
      logger.info("Cross-private nudge loop completed.");
    } catch (error) {
      logger.error({ error }, "Cross-private nudge loop failed.");
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
