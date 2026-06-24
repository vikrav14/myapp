import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { parseUserMindSnapshot, userMindSnapshotSchema, type UserMindSnapshotPayload } from "../schemas/user-mind.js";
import type { MauriUser, UserMindRecord } from "../types.js";
import { generateUserMindSnapshot } from "./ai.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { findUserById } from "./user.service.js";
import {
  DEFAULT_USER_MIND_BATCH_SIZE
} from "./user-mind.constants.js";
import {
  buildReflectionWindow,
  hasReflectionSignal,
  loadUserMindReflectionInput
} from "./user-mind-data.service.js";

export { formatUserMindForPrompt } from "./user-mind-prompt.js";

function parseStoredSnapshot(snapshot: unknown): UserMindSnapshotPayload {
  if (typeof snapshot === "string") {
    return parseUserMindSnapshot(snapshot);
  }

  return userMindSnapshotSchema.parse(snapshot);
}

function mapMindRecord(record: Record<string, unknown>): UserMindRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    snapshot: parseStoredSnapshot(record.snapshot),
    source_window_start: String(record.source_window_start),
    source_window_end: String(record.source_window_end),
    generated_at: String(record.generated_at),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export async function getUserMindSnapshot(userId: string): Promise<UserMindRecord | null> {
  const { data, error } = await supabase
    .from("user_mind_snapshots")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load user mind snapshot: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const snapshot = parseStoredSnapshot(data.snapshot);
  return {
    ...mapMindRecord(data),
    snapshot
  };
}

export async function saveUserMindSnapshot(input: {
  userId: string;
  snapshot: UserMindSnapshotPayload;
  sourceWindowStart: string;
  sourceWindowEnd: string;
}): Promise<UserMindRecord> {
  const generatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_mind_snapshots")
    .upsert(
      {
        user_id: input.userId,
        snapshot: input.snapshot,
        source_window_start: input.sourceWindowStart,
        source_window_end: input.sourceWindowEnd,
        generated_at: generatedAt,
        updated_at: generatedAt
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save user mind snapshot: ${error.message}`);
  }

  return {
    ...mapMindRecord(data),
    snapshot: input.snapshot
  };
}

export async function reflectUserMind(input: {
  user: MauriUser;
  lookbackDays?: number;
  requestId?: string | undefined;
}): Promise<{ reflected: boolean; reason?: string; record?: UserMindRecord }> {
  if (input.user.onboarding_state !== "active") {
    return { reflected: false, reason: "onboarding_incomplete" };
  }

  if (input.user.subscription_status === "Locked") {
    return { reflected: false, reason: "locked" };
  }

  const lookbackDays = input.lookbackDays ?? env.USER_MIND_LOOKBACK_DAYS;
  const window = buildReflectionWindow(new Date(), lookbackDays);
  const existing = await getUserMindSnapshot(input.user.id);
  const reflectionInput = await loadUserMindReflectionInput({
    user: input.user,
    window,
    previousMindSnapshot: existing?.snapshot ?? null
  });

  if (!hasReflectionSignal(reflectionInput)) {
    return { reflected: false, reason: "insufficient_signal" };
  }

  const snapshot = await generateUserMindSnapshot(reflectionInput);
  const record = await saveUserMindSnapshot({
    userId: input.user.id,
    snapshot,
    sourceWindowStart: window.start,
    sourceWindowEnd: window.end
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "user_mind_reflected",
    actorType: "system",
    userId: input.user.id,
    entityType: "user_mind_snapshot",
    entityId: record.id,
    message: "Off-peak user mind snapshot generated.",
    metadata: {
      lookbackDays,
      financeCount: reflectionInput.financeLogs.length,
      conversationCount: reflectionInput.conversationSamples.length
    }
  });

  return { reflected: true, record };
}

export async function listUsersForMindReflection(limit: number = DEFAULT_USER_MIND_BATCH_SIZE): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - env.USER_MIND_ACTIVITY_LOOKBACK_DAYS);

  const { data: memoryRows, error: memoryError } = await supabase
    .from("conversation_memories")
    .select("user_id")
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (memoryError) {
    throw new Error(`Failed to list active users for mind reflection: ${memoryError.message}`);
  }

  const candidateIds = [...new Set((memoryRows ?? []).map((row) => String(row.user_id)).filter(Boolean))];
  if (candidateIds.length === 0) {
    return [];
  }

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, onboarding_state, subscription_status")
    .in("id", candidateIds.slice(0, 200));

  if (usersError) {
    throw new Error(`Failed to filter users for mind reflection: ${usersError.message}`);
  }

  return (users ?? [])
    .filter(
      (row) =>
        String(row.onboarding_state) === "active" &&
        ["Trial_Active", "Paid_Active"].includes(String(row.subscription_status))
    )
    .map((row) => String(row.id))
    .slice(0, limit);
}

export async function runUserMindReflectionBatch(input?: {
  userIds?: string[];
  requestId?: string | undefined;
}): Promise<{ attempted: number; reflected: number; skipped: number; failed: number }> {
  if (!env.USER_MIND_ENABLED) {
    return { attempted: 0, reflected: 0, skipped: 0, failed: 0 };
  }

  const userIds = input?.userIds ?? (await listUsersForMindReflection(env.USER_MIND_BATCH_SIZE));
  let reflected = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      const user = await findUserById(userId);
      if (!user) {
        skipped += 1;
        continue;
      }

      const result = await reflectUserMind({
        user,
        requestId: input?.requestId
      });

      if (result.reflected) {
        reflected += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logger.warn({ error, userId }, "User mind reflection failed for user.");
    }
  }

  logger.info(
    { attempted: userIds.length, reflected, skipped, failed },
    "User mind reflection batch completed."
  );

  return {
    attempted: userIds.length,
    reflected,
    skipped,
    failed
  };
}

export async function reflectUserMindById(userId: string, requestId?: string): Promise<UserMindRecord | null> {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const result = await reflectUserMind({ user, requestId });
  return result.record ?? null;
}
