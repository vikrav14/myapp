import cron from "node-cron";

import { scheduleCronJobSafely } from "../lib/cron-safe.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runLocalAlertPipeline } from "../services/local-alerts-delivery.service.js";

export async function runLocalAlerts(): Promise<void> {
  if (!env.LOCAL_ALERTS_ENABLED) {
    return;
  }

  await runLocalAlertPipeline();
}

export function registerLocalAlertsJobs(): void {
  if (!env.LOCAL_ALERTS_ENABLED) {
    logger.info("Local alerts jobs disabled.");
    return;
  }

  cron.schedule(
    env.LOCAL_ALERTS_CRON,
    scheduleCronJobSafely("local_alerts", runLocalAlerts),
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      cron: env.LOCAL_ALERTS_CRON
    },
    "Local alerts jobs registered."
  );
}
