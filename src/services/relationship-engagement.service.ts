import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import type { UserMindSnapshotPayload } from "../schemas/user-mind.js";
import type { MauriUser, UserMindFact } from "../types.js";
import { generateTierOneDeepenReply } from "./ai.service.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { loadUserMindFacts } from "./user-mind.service.js";
import { getUserMindSnapshot } from "./user-mind-snapshot.service.js";
import { canSendProactiveOutbound, recordProactivePing } from "./outbound-pace.service.js";
import { appendMatePingReceipt } from "./notification-pace.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { mapUser } from "./user.service.js";
import { sendMauriReply, sendWhatsAppMessage } from "./whatsapp.service.js";
import { buildMorningMoodCheckInteractive } from "./whatsapp-interactive.service.js";
import {
  EVENING_PING_MIN_HOURS_AFTER_ONBOARDING,
  EVENING_PING_MIN_HOURS_AFTER_USER,
  RELATIONSHIP_EVENING_PING_KEY_PREFIX,
  RELATIONSHIP_MORNING_MOOD_KEY_PREFIX,
  RELATIONSHIP_REMINDER_NUDGE_KEY_PREFIX,
  RELATIONSHIP_TIER1_DEEPEN_KEY_PREFIX,
  TIER1_DEEPEN_WINDOW_HOURS,
  TRIAL_RELATIONSHIP_WINDOW_DAYS
} from "./relationship-engagement.constants.js";

export interface RelationshipCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

function relationshipDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function hoursSince(date: Date | null): number | null {
  if (!date) {
    return null;
  }

  return (Date.now() - date.getTime()) / (60 * 60 * 1000);
}

export function isWithinTrialRelationshipWindow(user: MauriUser): boolean {
  if (!user.trial_started_at) {
    return false;
  }

  const elapsedDays = (Date.now() - new Date(user.trial_started_at).getTime()) / (24 * 60 * 60 * 1000);
  return elapsedDays <= TRIAL_RELATIONSHIP_WINDOW_DAYS;
}

async function getLastUserMessageAt(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("conversation_memories")
    .select("created_at")
    .eq("user_id", userId)
    .eq("memory_type", "user_message")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last user message: ${error.message}`);
  }

  return data?.created_at ? new Date(String(data.created_at)) : null;
}

function pickOpenThreadSnippet(input: {
  facts: UserMindFact[];
  mind: UserMindSnapshotPayload | null;
}): string | null {
  const fromMind = input.mind?.open_loops?.map((loop) => loop.trim()).find(Boolean);
  if (fromMind) {
    return fromMind;
  }

  const priorityPattern =
    /\b(career|money|drink|lost|change|struggling|biopsy|family|mum|dad|waiting|heavy|not looking good)\b/i;

  const ranked = input.facts
    .filter((fact) => ["stressors", "goals", "relationships", "life_context"].includes(fact.category))
    .map((fact) => `${fact.fact_key} ${fact.fact_value}`.trim())
    .filter((text) => text.length >= 8)
    .sort((left, right) => {
      const leftScore = priorityPattern.test(left) ? 1 : 0;
      const rightScore = priorityPattern.test(right) ? 1 : 0;
      return rightScore - leftScore || right.length - left.length;
    });

  return ranked[0] ?? null;
}

export function buildEveningRelationshipPing(input: {
  firstName?: string | null;
  threadSnippet: string;
}): string {
  const name = input.firstName?.trim() || "there";
  const snippet =
    input.threadSnippet.length > 100 ? `${input.threadSnippet.slice(0, 97)}...` : input.threadSnippet;

  return `Hey ${name} — separate from this morning's news.

You opened up about ${snippet.toLowerCase().startsWith("you") ? snippet : snippet.toLowerCase()}.

Still on your mind today, or a bit lighter? One word is fine — or just brain dump here.

Reply not now anytime to pause these check-ins.`;
}

export function buildMorningMoodPrompt(firstName?: string | null): string {
  const name = firstName?.trim() || "there";
  return `Off the news, ${name} — how's today feeling vs yesterday? Tap 1–5 or reply skip.`;
}

export function parseMorningMoodReply(message: string): number | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  const match = normalized.match(/^mood (\d)$/);
  if (!match) {
    return null;
  }

  const score = Number(match[1]);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return null;
  }

  return score;
}

export function parseSkipRelationshipPing(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "skip" || normalized === "skip mood" || normalized === "skip checkin";
}

const TIER1_RELIEF_PATTERN =
  /\b(thank you|thanks|thx|feel better|feeling better|helped|glad|noted|appreciate|means a lot|that helps)\b/i;

export function isTierOneReliefMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4 || trimmed.length > 180) {
    return false;
  }

  return TIER1_RELIEF_PATTERN.test(trimmed);
}

function userHasHeavyProfile(facts: UserMindFact[]): boolean {
  return facts.some((fact) =>
    ["stressors", "relationships"].includes(fact.category) ||
    /\b(struggling|drink|lost|career|money|heavy|not looking good|anxious|scared)\b/i.test(
      `${fact.fact_key} ${fact.fact_value}`
    )
  );
}

export function buildReminderCompletionNudge(firstName?: string | null): string {
  const name = firstName?.trim() || "there";
  return `\n\nNice one, ${name}. Want another small reminder, or done for today?`;
}

export async function logMorningMoodScore(input: {
  userId: string;
  score: number;
  source: "interactive" | "text";
}): Promise<void> {
  const { error } = await supabase.from("insights_vault").insert({
    user_id: input.userId,
    anxiety_score: input.score,
    core_emotional_driver: "morning_mood_check",
    raw_unfiltered_vent: `Morning mood check: ${input.score}/5 (${input.source})`
  });

  if (error) {
    throw new Error(`Failed to log morning mood: ${error.message}`);
  }
}

export async function handleMorningMoodMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<RelationshipCommandResult> {
  if (parseSkipRelationshipPing(input.message)) {
    return {
      handled: true,
      reply: "No worries — skip anytime. Your brief still lands at 7."
    };
  }

  const score = parseMorningMoodReply(input.message);
  if (score === null) {
    return { handled: false };
  }

  const deliveryKey = `${RELATIONSHIP_MORNING_MOOD_KEY_PREFIX}${relationshipDateKey()}`;
  await logMorningMoodScore({ userId: input.user.id, score, source: "text" });
  await recordEngagementDelivery(input.user.id, deliveryKey);

  const name = input.user.first_name?.trim() || "there";
  return {
    handled: true,
    reply: `Got it, ${name} — logged ${score}/5 for today. I'm keeping the personal stuff out of your 7am pulse.`
  };
}

export async function resolveTierOneDeepenReply(input: {
  user: MauriUser;
  message: string;
  facts: UserMindFact[];
}): Promise<string> {
  try {
    return await generateTierOneDeepenReply({
      firstName: input.user.first_name,
      message: input.message,
      facts: input.facts
    });
  } catch (error) {
    logger.warn({ error, userId: input.user.id }, "Tier-1 deepen AI failed; using template fallback.");
    const name = input.user.first_name?.trim() || "there";
    const thread = pickOpenThreadSnippet({ facts: input.facts, mind: null });
    if (thread) {
      return `Glad it landed, ${name}. What's still heaviest — tied to ${thread.toLowerCase()}? One word is fine, or ignore if you're done for tonight.`;
    }

    return `Glad it landed, ${name}. What's still sitting heaviest from what you shared — money, direction, or just the weight of it all? One word is fine.`;
  }
}

export async function handleTierOneDeepenMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<RelationshipCommandResult> {
  if (!isTierOneReliefMessage(input.message)) {
    return { handled: false };
  }

  if (!isWithinTrialRelationshipWindow(input.user) && !input.user.onboarding_completed_at) {
    return { handled: false };
  }

  const withinDeepenWindow =
    input.user.onboarding_completed_at &&
    hoursSince(new Date(input.user.onboarding_completed_at)) !== null &&
    hoursSince(new Date(input.user.onboarding_completed_at))! <= TIER1_DEEPEN_WINDOW_HOURS;

  if (!withinDeepenWindow && !isWithinTrialRelationshipWindow(input.user)) {
    return { handled: false };
  }

  const deliveryKey = `${RELATIONSHIP_TIER1_DEEPEN_KEY_PREFIX}${relationshipDateKey()}`;
  if (await hasEngagementDelivery(input.user.id, deliveryKey)) {
    return { handled: false };
  }

  const facts = await loadUserMindFacts(input.user.id);
  if (!userHasHeavyProfile(facts) && !isWithinTrialRelationshipWindow(input.user)) {
    return { handled: false };
  }

  const reply = await resolveTierOneDeepenReply({
    user: input.user,
    message: input.message,
    facts
  });

  await recordEngagementDelivery(input.user.id, deliveryKey);

  return { handled: true, reply };
}

export async function maybeAppendReminderCompletionNudge(input: {
  user: MauriUser;
  baseReply: string;
}): Promise<string> {
  if (!isWithinTrialRelationshipWindow(input.user)) {
    return input.baseReply;
  }

  const deliveryKey = `${RELATIONSHIP_REMINDER_NUDGE_KEY_PREFIX}${relationshipDateKey()}`;
  if (await hasEngagementDelivery(input.user.id, deliveryKey)) {
    return input.baseReply;
  }

  await recordEngagementDelivery(input.user.id, deliveryKey);
  return `${input.baseReply}${buildReminderCompletionNudge(input.user.first_name)}`;
}

export async function deliverMorningMoodCheck(input: {
  user: MauriUser;
  requestId?: string | undefined;
}): Promise<boolean> {
  if (!env.WHATSAPP_INTERACTIVE_ENABLED || !isWithinTrialRelationshipWindow(input.user)) {
    return false;
  }

  const deliveryKey = `${RELATIONSHIP_MORNING_MOOD_KEY_PREFIX}${relationshipDateKey()}`;
  if (await hasEngagementDelivery(input.user.id, deliveryKey)) {
    return false;
  }

  const gate = await canSendProactiveOutbound(input.user, "proactive_checkin");
  if (!gate.allowed) {
    return false;
  }

  await sendMauriReply(
    input.user.phone_number,
    {
      text: buildMorningMoodPrompt(input.user.first_name),
      interactive: buildMorningMoodCheckInteractive()
    },
    {
      userId: input.user.id,
      requestId: input.requestId,
      metadata: { flow: "morning_mood_check" }
    }
  );

  await recordEngagementDelivery(input.user.id, deliveryKey);
  await recordProactivePing(input.user.id, "proactive_checkin");
  return true;
}

export async function runEveningRelationshipDeliveries(requestId?: string): Promise<{ sent: number; skipped: number }> {
  if (!env.RELATIONSHIP_ENGAGEMENT_ENABLED) {
    return { sent: 0, skipped: 0 };
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("subscription_status", "Trial_Active");

  if (error) {
    throw new Error(`Failed to load trial users for evening ping: ${error.message}`);
  }

  let sent = 0;
  let skipped = 0;

  for (const row of data ?? []) {
    const user = mapUser(row as Record<string, unknown>);
    if (!isReminderEligible(user) || !isWithinTrialRelationshipWindow(user)) {
      skipped += 1;
      continue;
    }

    const eveningKey = `${RELATIONSHIP_EVENING_PING_KEY_PREFIX}${relationshipDateKey()}`;
    if (await hasEngagementDelivery(user.id, eveningKey)) {
      skipped += 1;
      continue;
    }

    const onboardingHours = hoursSince(user.onboarding_completed_at ? new Date(user.onboarding_completed_at) : null);
    if (onboardingHours === null || onboardingHours < EVENING_PING_MIN_HOURS_AFTER_ONBOARDING) {
      skipped += 1;
      continue;
    }

    const lastMessageHours = hoursSince(await getLastUserMessageAt(user.id));
    if (lastMessageHours !== null && lastMessageHours < EVENING_PING_MIN_HOURS_AFTER_USER) {
      skipped += 1;
      continue;
    }

    const gate = await canSendProactiveOutbound(user, "proactive_checkin");
    if (!gate.allowed) {
      skipped += 1;
      continue;
    }

    const [facts, mindRecord] = await Promise.all([loadUserMindFacts(user.id), getUserMindSnapshot(user.id)]);
    const threadSnippet = pickOpenThreadSnippet({ facts, mind: mindRecord?.snapshot ?? null });
    if (!threadSnippet) {
      skipped += 1;
      continue;
    }

    try {
      const message = await appendMatePingReceipt(
        user,
        buildEveningRelationshipPing({
          firstName: user.first_name,
          threadSnippet
        })
      );

      await sendWhatsAppMessage(user.phone_number, message, {
        userId: user.id,
        requestId,
        metadata: { flow: "relationship_evening_ping" }
      });

      await recordEngagementDelivery(user.id, eveningKey);
      await recordProactivePing(user.id, "proactive_checkin");
      sent += 1;
    } catch (deliveryError) {
      skipped += 1;
      logger.warn({ error: deliveryError, userId: user.id }, "Failed evening relationship ping.");
    }
  }

  return { sent, skipped };
}
