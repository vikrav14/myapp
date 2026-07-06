import cron from "node-cron";

import { scheduleCronJobSafely } from "../lib/cron-safe.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { deliverCalendarNotifications } from "../services/calendar-delivery.service.js";
import { syncAllActiveCalendars } from "../services/calendar.service.js";

export async function runCalendarSync(): Promise<void> {
  if (!env.CALENDAR_SYNC_ENABLED) {
    return;
  }

  const result = await syncAllActiveCalendars();
  if (result.users > 0) {
    logger.info(result, "Calendar sync completed.");
  }
}

export async function runCalendarDelivery(): Promise<void> {
  if (!env.CALENDAR_SYNC_ENABLED) {
    return;
  }

  await deliverCalendarNotifications();
}

export function registerCalendarJobs(): void {
  if (!env.CALENDAR_SYNC_ENABLED) {
    logger.info("Calendar jobs disabled.");
    return;
  }

  const timezone = env.MORNING_BRIEF_TIMEZONE;

  cron.schedule(
    env.CALENDAR_SYNC_CRON,
    scheduleCronJobSafely("calendar_sync", runCalendarSync),
    { timezone }
  );

  cron.schedule(
    env.CALENDAR_DELIVERY_CRON,
    scheduleCronJobSafely("calendar_delivery", runCalendarDelivery),
    { timezone }
  );

  logger.info(
    {
      timezone,
      syncCron: env.CALENDAR_SYNC_CRON,
      deliveryCron: env.CALENDAR_DELIVERY_CRON
    },
    "Calendar jobs registered."
  );
}
