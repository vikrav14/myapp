import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  buildLocalAlertMessage,
  getRecentLocalAlerts,
  ingestNewLocalAlerts,
  markAlertDelivered,
  shouldDeliverAlertToUser,
  type LocalAlertRecord
} from "./local-alerts.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { mapUser, updateUserState } from "./user.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export interface LocalAlertsCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

function isAlertEligible(user: MauriUser): boolean {
  return isReminderEligible(user);
}

export async function listAlertEligibleUsers(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("local_alerts_enabled", true)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to load alert recipients: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isAlertEligible);
}

export async function deliverLocalAlerts(input: {
  alerts: LocalAlertRecord[];
  requestId?: string | undefined;
}): Promise<{ sent: number; skipped: number }> {
  if (input.alerts.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const users = await listAlertEligibleUsers();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    for (const alert of input.alerts) {
      if (
        !shouldDeliverAlertToUser({
          alertType: alert.alert_type,
          localAlertsEnabled: user.local_alerts_enabled,
          schoolAlertsEnabled: user.school_alerts_enabled
        })
      ) {
        skipped += 1;
        continue;
      }

      const message = buildLocalAlertMessage(alert);

      try {
        await sendWhatsAppMessage(user.phone_number, message, {
          userId: user.id,
          requestId: input.requestId,
          metadata: {
            flow: "local_alert",
            alertId: alert.id,
            alertType: alert.alert_type,
            severity: alert.severity
          }
        });
        await markAlertDelivered(alert.id, user.id);
        sent += 1;
      } catch (error) {
        skipped += 1;
        logger.warn({ error, userId: user.id, alertId: alert.id }, "Failed local alert delivery.");
      }
    }
  }

  return { sent, skipped };
}

export async function runLocalAlertPipeline(requestId?: string): Promise<{
  scanned: number;
  created: number;
  sent: number;
}> {
  const ingestion = await ingestNewLocalAlerts();
  const delivery = await deliverLocalAlerts({
    alerts: ingestion.alerts,
    requestId
  });

  if (ingestion.created > 0 || delivery.sent > 0) {
    logger.info(
      {
        scanned: ingestion.scanned,
        created: ingestion.created,
        sent: delivery.sent,
        skipped: delivery.skipped
      },
      "Local alert pipeline completed."
    );
  }

  return {
    scanned: ingestion.scanned,
    created: ingestion.created,
    sent: delivery.sent
  };
}

export function parseLocalAlertsCommand(
  message: string
): { type: "alerts"; enabled: boolean } | { type: "school"; enabled: boolean } | { type: "status" } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized === "alerts on" || normalized === "local alerts on") {
    return { type: "alerts", enabled: true };
  }

  if (normalized === "alerts off" || normalized === "local alerts off") {
    return { type: "alerts", enabled: false };
  }

  if (normalized === "school alerts on") {
    return { type: "school", enabled: true };
  }

  if (normalized === "school alerts off") {
    return { type: "school", enabled: false };
  }

  if (normalized === "my alerts" || normalized === "recent alerts" || normalized === "alert status") {
    return { type: "status" };
  }

  return null;
}

export async function handleLocalAlertsCommandMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<LocalAlertsCommandResult> {
  if (!env.LOCAL_ALERTS_ENABLED) {
    return { handled: false };
  }

  const command = parseLocalAlertsCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first, then you can control Mauri alerts here."
    };
  }

  if (!isAlertEligible(input.user)) {
    return {
      handled: true,
      user: input.user,
      reply: "Local alerts are part of your Mauri trial or subscription. Reply pay to unlock access."
    };
  }

  if (command.type === "status") {
    const alerts = await getRecentLocalAlerts(5);
    if (alerts.length === 0) {
      return {
        handled: true,
        user: input.user,
        reply:
          "No urgent local alerts in the last day.\n\nMauri watches overnight advisories — school closures, heavy rain, cyclone warnings — and pings you when it matters.\n\nalerts on · school alerts on"
      };
    }

    const lines = alerts.map((alert, index) => `${index + 1}. ${alert.title} (${alert.alert_type.replace("_", " ")})`);
    return {
      handled: true,
      user: input.user,
      reply: `Recent Mauri alerts\n\n${lines.join("\n")}\n\nalerts ${input.user.local_alerts_enabled ? "off" : "on"} · school alerts ${input.user.school_alerts_enabled ? "off" : "on"}`
    };
  }

  if (command.type === "alerts") {
    const updatedUser = await updateUserState(input.user.id, {
      local_alerts_enabled: command.enabled
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "local_alerts_toggled",
      userId: updatedUser.id,
      entityType: "user",
      entityId: updatedUser.id,
      message: command.enabled ? "User enabled local alerts." : "User disabled local alerts.",
      metadata: { local_alerts_enabled: command.enabled }
    });

    return {
      handled: true,
      user: updatedUser,
      reply: command.enabled
        ? "Local alerts are on. I'll ping you for school closures, heavy rain, cyclone warnings, and other urgent Mauritius advisories."
        : "Local alerts are off. You won't get urgent advisory pings."
    };
  }

  const updatedUser = await updateUserState(input.user.id, {
    school_alerts_enabled: command.enabled
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "school_alerts_toggled",
    userId: updatedUser.id,
    entityType: "user",
    entityId: updatedUser.id,
    message: command.enabled ? "User enabled school alerts." : "User disabled school alerts.",
    metadata: { school_alerts_enabled: command.enabled }
  });

  return {
    handled: true,
    user: updatedUser,
    reply: command.enabled
      ? "School alerts are on. I'll ping you when classes are closed or parents are told to keep kids home."
      : "School alerts are off. You'll still get heavy rain and cyclone alerts if local alerts are on."
  };
}
