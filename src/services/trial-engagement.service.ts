import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import type { MauriUser } from "../types.js";
import {
  buildRecentActivitySnapshot,
  buildTrialProgressPing,
  buildTrialSquadInvite
} from "./engagement-stats.service.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { buildDailyMicroLessonSection } from "./micro-lesson.service.js";
import { mapUser } from "./user.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

function trialDayNumber(user: MauriUser): number | null {
  if (!user.trial_started_at) {
    return null;
  }

  const started = new Date(user.trial_started_at).getTime();
  const elapsedDays = Math.floor((Date.now() - started) / (24 * 60 * 60 * 1000));
  return elapsedDays + 1;
}

function isTrialEligible(user: MauriUser): boolean {
  return (
    user.onboarding_state === "active" &&
    user.subscription_status === "Trial_Active" &&
    Boolean(user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now())
  );
}

export async function listActiveTrialUsers(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("subscription_status", "Trial_Active");

  if (error) {
    throw new Error(`Failed to load trial users: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isTrialEligible);
}

export async function runTrialEngagementDeliveries(requestId?: string): Promise<{
  progressPings: number;
  squadInvites: number;
}> {
  const users = await listActiveTrialUsers();
  let progressPings = 0;
  let squadInvites = 0;

  for (const user of users) {
    const day = trialDayNumber(user);
    if (!day) {
      continue;
    }

    try {
      if (day >= 2) {
        const squadKey = "trial_day2_squad_invite";
        if (!(await hasEngagementDelivery(user.id, squadKey))) {
          const squadMessage = buildTrialSquadInvite(user);
          await sendWhatsAppMessage(user.phone_number, squadMessage, {
            userId: user.id,
            requestId,
            metadata: { flow: "trial_squad_invite", trialDay: day }
          });
          await recordEngagementDelivery(user.id, squadKey);
          squadInvites += 1;
        }
      }

      if (day >= 3) {
        const key = "trial_day3_progress";
        if (!(await hasEngagementDelivery(user.id, key))) {
          const snapshot = await buildRecentActivitySnapshot(user.id);
          const message = buildTrialProgressPing(user, snapshot);
          await sendWhatsAppMessage(user.phone_number, message, {
            userId: user.id,
            requestId,
            metadata: { flow: "trial_progress_ping", trialDay: day }
          });
          await recordEngagementDelivery(user.id, key);
          progressPings += 1;
        }
      }
    } catch (error) {
      logger.warn({ error, userId: user.id }, "Failed trial engagement delivery for user.");
    }
  }

  return { progressPings, squadInvites };
}

export async function appendMicroLessonToBriefMessage(user: MauriUser, message: string): Promise<string> {
  try {
    const section = await buildDailyMicroLessonSection(user);
    if (!section) {
      return message;
    }

    return `${message}\n\n${section}\n\nReply lesson or help anytime.`;
  } catch (error) {
    logger.warn({ error, userId: user.id }, "Failed to append micro lesson to morning brief.");
    return message;
  }
}

export function getTrialEngagementCron(): string {
  return env.TRIAL_ENGAGEMENT_CRON;
}
