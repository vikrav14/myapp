import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runProactiveCheckInDeliveries } from "../services/proactive-checkin.service.js";

export async function runProactiveCheckInJob(): Promise<void> {
  if (!env.PROACTIVE_CHECKINS_ENABLED) {
    return;
  }

  await runProactiveCheckInDeliveries();
}

export function registerProactiveCheckInJobs(): void {
  if (!env.PROACTIVE_CHECKINS_ENABLED) {
    logger.info("Proactive check-in jobs disabled.");
    return;
  }

  cron.schedule(
    env.PROACTIVE_CHECKIN_CRON,
    () => {
      void runProactiveCheckInJob();
    },
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      cron: env.PROACTIVE_CHECKIN_CRON,
      hour: env.PROACTIVE_CHECKIN_HOUR
    },
    "Proactive check-in jobs registered."
  );
}
