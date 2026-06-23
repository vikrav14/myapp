import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriBrainDumpExtraction, MauriUser } from "../types.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { formatSquadPactLine, scoreMemberLogs, scoringWeightsForSquad } from "./squad-pact.service.js";
import {
  findSquadForUser,
  hasSquadAccess,
  listSquadEligibleMemberIds,
  type SquadRecord
} from "./squad.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

const RELAY_WINDOW_DAYS = 3;

export function extractionEarnsSquadPoints(extraction: MauriBrainDumpExtraction): boolean {
  if (extraction.finance) {
    return true;
  }

  return Boolean(extraction.habits?.is_success);
}

export function buildRelayNudgeMessage(input: {
  laggerName: string;
  leaderName: string;
  squadName: string;
  pactLine?: string | null;
}): string {
  const pactTail = input.pactLine ? `\n\n${input.pactLine}` : "";
  return `${input.laggerName}, ${input.leaderName} just logged a win in ${input.squadName}. Your move — one message back.${pactTail}`;
}

function startOfWindow(daysBack: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - daysBack);
  return now.toISOString();
}

function displayName(firstName: string | null | undefined): string {
  return firstName?.trim() || "Someone";
}

function relayDeliveryKey(squadId: string, laggerId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `squad_relay_${squadId}_${laggerId}_${day}`;
}

function actorRelayCooldownKey(userId: string): string {
  const hourBucket = new Date().toISOString().slice(0, 13);
  return `squad_relay_actor_${userId}_${hourBucket}`;
}

async function scoreSquadMembersSince(squad: SquadRecord, memberIds: string[], sinceIso: string): Promise<Map<string, number>> {
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

export async function maybeSendSquadRelayNudges(input: {
  user: MauriUser;
  extraction: MauriBrainDumpExtraction;
  requestId?: string | undefined;
}): Promise<number> {
  if (!extractionEarnsSquadPoints(input.extraction) || !hasSquadAccess(input.user)) {
    return 0;
  }

  const squad = await findSquadForUser(input.user.id);
  if (!squad) {
    return 0;
  }

  const eligibleMemberIds = await listSquadEligibleMemberIds(squad.member_ids);
  if (eligibleMemberIds.length < 2 || !eligibleMemberIds.includes(input.user.id)) {
    return 0;
  }

  if (await hasEngagementDelivery(input.user.id, actorRelayCooldownKey(input.user.id))) {
    return 0;
  }

  const scores = await scoreSquadMembersSince(squad, eligibleMemberIds, startOfWindow(RELAY_WINDOW_DAYS));
  const actorScore = scores.get(input.user.id) ?? 0;
  if (actorScore <= 0) {
    return 0;
  }

  const topScore = Math.max(...eligibleMemberIds.map((memberId) => scores.get(memberId) ?? 0));
  if (actorScore < topScore) {
    return 0;
  }

  const laggers = eligibleMemberIds.filter(
    (memberId) => memberId !== input.user.id && (scores.get(memberId) ?? 0) < actorScore - 1
  );
  if (!laggers.length) {
    return 0;
  }

  const { data: members, error } = await supabase
    .from("users")
    .select("id, phone_number, first_name")
    .in("id", [...laggers, input.user.id]);

  if (error) {
    throw new Error(`Failed to load squad members for relay nudge: ${error.message}`);
  }

  const membersById = new Map(
    (members ?? []).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        phone_number: String(row.phone_number),
        first_name: row.first_name ? String(row.first_name) : null
      }
    ])
  );

  const leaderName = displayName(membersById.get(input.user.id)?.first_name);
  const pactLine = formatSquadPactLine(squad);
  let sent = 0;

  for (const laggerId of laggers) {
    const deliveryKey = relayDeliveryKey(squad.id, laggerId);
    if (await hasEngagementDelivery(laggerId, deliveryKey)) {
      continue;
    }

    const lagger = membersById.get(laggerId);
    if (!lagger) {
      continue;
    }

    const message = buildRelayNudgeMessage({
      laggerName: displayName(lagger.first_name),
      leaderName,
      squadName: squad.squad_name,
      pactLine
    });

    await sendWhatsAppMessage(lagger.phone_number, message, {
      userId: lagger.id,
      requestId: input.requestId,
      metadata: {
        flow: "squad_relay_nudge",
        squadName: squad.squad_name,
        leaderUserId: input.user.id
      }
    });
    await recordEngagementDelivery(laggerId, deliveryKey);
    sent += 1;
  }

  if (sent > 0) {
    await recordEngagementDelivery(input.user.id, actorRelayCooldownKey(input.user.id));
  }

  return sent;
}

export async function runSquadRelayAfterExtraction(input: {
  user: MauriUser;
  extraction: MauriBrainDumpExtraction;
  requestId?: string | undefined;
}): Promise<void> {
  try {
    const sent = await maybeSendSquadRelayNudges(input);
    if (sent > 0) {
      logger.info(
        {
          userId: input.user.id,
          relayNudgesSent: sent
        },
        "Squad relay nudges sent after scoring extraction."
      );
    }
  } catch (error) {
    logger.warn({ error, userId: input.user.id }, "Failed to send squad relay nudges.");
  }
}
