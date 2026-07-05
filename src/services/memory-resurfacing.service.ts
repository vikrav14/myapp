import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { generateMemoryResurfaceMessage } from "./ai.service.js";
import { parseMemoryResurfaceToggle } from "./calendar-parse.service.js";
import { canSendProactiveOutbound, recordProactivePing } from "./outbound-pace.service.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { mapUser, updateUserState } from "./user.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export interface MemoryResurfaceCandidate {
  memorySource: "conversation_memory" | "insight_memory" | "todo";
  memoryId: string;
  memoryText: string;
  deliveryKey: string;
}

export interface MemoryResurfaceCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

const MIN_MEMORY_AGE_DAYS = 7;
const RESURFACE_COOLDOWN_DAYS = 30;
const MAX_MEMORIES_PER_DAY = 1;

function resurfaceDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function buildFallbackResurfaceMessage(user: MauriUser, memoryText: string): string {
  const snippet = memoryText.length > 120 ? `${memoryText.slice(0, 117)}...` : memoryText;
  const name = user.first_name ?? "there";
  return `Hey ${name}, something you mentioned a while back is still sitting with me:

"${snippet}"

Still on your mind, or time to let it go?`;
}

export async function listResurfaceEligibleUsers(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("memory_resurfacing_enabled", true)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to load resurfacing users: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isReminderEligible);
}

async function loadRecentDeliveryKeys(userId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - RESURFACE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("memory_resurfacing_log")
    .select("delivery_key")
    .eq("user_id", userId)
    .gte("surfaced_at", cutoff);

  if (error) {
    throw new Error(`Failed to load resurfacing history: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).delivery_key)));
}

export async function pickResurfaceCandidate(userId: string): Promise<MemoryResurfaceCandidate | null> {
  const recentKeys = await loadRecentDeliveryKeys(userId);
  const memoryCutoff = new Date(Date.now() - MIN_MEMORY_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: conversationRows, error: conversationError } = await supabase
    .from("conversation_memories")
    .select("id, content_text, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "user_message")
    .lt("created_at", memoryCutoff)
    .order("created_at", { ascending: true })
    .limit(20);

  if (conversationError) {
    throw new Error(`Failed to load conversation memories: ${conversationError.message}`);
  }

  for (const row of conversationRows ?? []) {
    const record = row as Record<string, unknown>;
    const memoryId = String(record.id);
    const deliveryKey = `memory_resurface_conversation_${memoryId}`;
    const text = String(record.content_text ?? "").trim();
    if (!text || recentKeys.has(deliveryKey) || text.length < 20) {
      continue;
    }

    return {
      memorySource: "conversation_memory",
      memoryId,
      memoryText: text,
      deliveryKey
    };
  }

  const { data: insightRows, error: insightError } = await supabase
    .from("insights_vault")
    .select("id, raw_unfiltered_vent, anxiety_score, logged_at")
    .eq("user_id", userId)
    .gte("anxiety_score", 3)
    .lt("logged_at", memoryCutoff)
    .order("logged_at", { ascending: true })
    .limit(10);

  if (insightError) {
    throw new Error(`Failed to load insight memories: ${insightError.message}`);
  }

  for (const row of insightRows ?? []) {
    const record = row as Record<string, unknown>;
    const memoryId = String(record.id);
    const deliveryKey = `memory_resurface_insight_${memoryId}`;
    const text = String(record.raw_unfiltered_vent ?? "").trim();
    if (!text || recentKeys.has(deliveryKey)) {
      continue;
    }

    return {
      memorySource: "insight_memory",
      memoryId,
      memoryText: text,
      deliveryKey
    };
  }

  const { data: todoRows, error: todoError } = await supabase
    .from("todo_logs")
    .select("id, task_description, created_at")
    .eq("user_id", userId)
    .eq("is_completed", false)
    .lt("created_at", memoryCutoff)
    .order("created_at", { ascending: true })
    .limit(10);

  if (todoError) {
    throw new Error(`Failed to load todo resurfacing candidates: ${todoError.message}`);
  }

  for (const row of todoRows ?? []) {
    const record = row as Record<string, unknown>;
    const memoryId = String(record.id);
    const deliveryKey = `memory_resurface_todo_${memoryId}`;
    const text = String(record.task_description ?? "").trim();
    if (!text || recentKeys.has(deliveryKey)) {
      continue;
    }

    return {
      memorySource: "todo",
      memoryId,
      memoryText: text,
      deliveryKey
    };
  }

  return null;
}

export async function buildResurfaceMessage(user: MauriUser, candidate: MemoryResurfaceCandidate): Promise<string> {
  try {
    const message = await generateMemoryResurfaceMessage({
      user,
      memoryText: candidate.memoryText,
      memorySource: candidate.memorySource,
      weeklyFocus: user.weekly_focus_habit
    });
    return message.trim();
  } catch (error) {
    logger.warn({ error, userId: user.id }, "Falling back to template memory resurfacing message.");
    return buildFallbackResurfaceMessage(user, candidate.memoryText);
  }
}

export async function runMemoryResurfacingDeliveries(requestId?: string): Promise<{
  eligible: number;
  sent: number;
  skipped: number;
}> {
  const users = await listResurfaceEligibleUsers();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const dailyKey = `memory_resurface_day_${resurfaceDateKey()}`;
    if (await hasEngagementDelivery(user.id, dailyKey)) {
      skipped += 1;
      continue;
    }

    const candidate = await pickResurfaceCandidate(user.id);
    if (!candidate) {
      skipped += 1;
      continue;
    }

    const gate = await canSendProactiveOutbound(user, "memory_resurface");
    if (!gate.allowed) {
      skipped += 1;
      continue;
    }

    try {
      const message = await buildResurfaceMessage(user, candidate);
      await sendWhatsAppMessage(user.phone_number, message, {
        userId: user.id,
        requestId,
        metadata: {
          flow: "memory_resurface",
          memorySource: candidate.memorySource,
          memoryId: candidate.memoryId
        }
      });

      await supabase.from("memory_resurfacing_log").insert({
        user_id: user.id,
        memory_source: candidate.memorySource,
        memory_id: candidate.memoryId,
        delivery_key: candidate.deliveryKey,
        message_text: message
      });
      await recordEngagementDelivery(user.id, dailyKey);
      await recordProactivePing(user.id, "memory_resurface");
      sent += 1;
    } catch (error) {
      skipped += 1;
      logger.warn({ error, userId: user.id }, "Failed memory resurfacing delivery for user.");
    }
  }

  if (sent > 0) {
    logger.info({ eligible: users.length, sent, skipped }, "Memory resurfacing delivery completed.");
  }

  return { eligible: users.length, sent, skipped };
}

export async function handleMemoryResurfaceToggleMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<MemoryResurfaceCommandResult> {
  if (!env.MEMORY_RESURFACING_ENABLED) {
    return { handled: false };
  }

  const toggle = parseMemoryResurfaceToggle(input.message);
  if (!toggle) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first, then you can control memory resurfacing here."
    };
  }

  const updatedUser = await updateUserState(input.user.id, {
    memory_resurfacing_enabled: toggle.enabled
  });

  return {
    handled: true,
    user: updatedUser,
    reply: toggle.enabled
      ? "Memory resurfacing is on. I'll gently bring back important things you shared — max once a day."
      : "Memory resurfacing is off. I won't proactively resurface old memories."
  };
}
