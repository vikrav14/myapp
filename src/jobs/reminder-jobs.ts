import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { deliverDueReminders } from "../services/reminder-delivery.service.js";

export async function runReminderDelivery(): Promise<void> {
  if (!env.REMINDERS_ENABLED) {
    return;
  }

  await deliverDueReminders();
}

export function registerReminderJobs(): void {
  if (!env.REMINDERS_ENABLED) {
    logger.info("Reminder jobs disabled.");
    return;
  }

  cron.schedule(
    env.REMINDER_DELIVERY_CRON,
    () => {
      void runReminderDelivery();
    },
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      deliveryCron: env.REMINDER_DELIVERY_CRON
    },
    "Reminder jobs registered."
  );
}
