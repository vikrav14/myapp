import { supabase } from "../lib/supabase.js";
import type { CuratedMorningBrief, DailyBriefRunRecord, MauriUser, MorningBriefTopicKey } from "../types.js";
import { mapUser } from "./user.service.js";
import { buildPersonalizedMorningBriefMessage } from "./morning-brief-curation.service.js";
import { parseCuratedMorningBrief } from "./morning-brief-run.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

function isDigestEligible(user: MauriUser): boolean {
  if (user.onboarding_state !== "active" || !user.morning_digest_enabled) {
    return false;
  }

  if (user.subscription_status === "Locked") {
    return false;
  }

  if (user.subscription_status === "Trial_Active") {
    return Boolean(user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now());
  }

  if (user.subscription_status === "Paid_Active") {
    return !user.subscription_ends_at || new Date(user.subscription_ends_at).getTime() > Date.now();
  }

  return false;
}

export async function listMorningDigestRecipients(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("morning_digest_enabled", true)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to load morning digest recipients: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isDigestEligible).filter(
    (user) => user.topic_preferences.length >= 3
  );
}

export async function deliverMorningBriefRun(input: {
  run: DailyBriefRunRecord;
  requestId?: string | undefined;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  const curated = parseCuratedMorningBrief(input.run.curated_payload);
  if (!curated) {
    throw new Error("Daily brief run is missing curated payload.");
  }

  const recipients = await listMorningDigestRecipients();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of recipients) {
    const topics = user.topic_preferences as MorningBriefTopicKey[];
    const message = buildPersonalizedMorningBriefMessage({
      firstName: user.first_name,
      topics,
      curated
    });

    try {
      await sendWhatsAppMessage(user.phone_number, message, {
        userId: user.id,
        requestId: input.requestId,
        metadata: {
          flow: "morning_brief",
          briefDate: input.run.brief_date
        }
      });

      await supabase.from("daily_brief_deliveries").insert({
        run_id: input.run.id,
        user_id: user.id,
        delivery_status: "sent",
        message_text: message,
        sent_at: new Date().toISOString()
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await supabase.from("daily_brief_deliveries").insert({
        run_id: input.run.id,
        user_id: user.id,
        delivery_status: "failed",
        message_text: message,
        error_message: error instanceof Error ? error.message : "delivery failed"
      });
    }
  }

  if (recipients.length === 0) {
    skipped += 1;
  }

  return { sent, failed, skipped };
}

export function previewMorningBriefMessage(input: {
  user: MauriUser;
  curated: CuratedMorningBrief;
}): string {
  return buildPersonalizedMorningBriefMessage({
    firstName: input.user.first_name,
    topics: input.user.topic_preferences as MorningBriefTopicKey[],
    curated: input.curated
  });
}
