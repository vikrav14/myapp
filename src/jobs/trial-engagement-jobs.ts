import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runTrialEngagementDeliveries } from "../services/trial-engagement.service.js";

export function registerTrialEngagementJobs(): void {
  if (!env.TRIAL_ENGAGEMENT_ENABLED) {
    logger.info("Trial engagement jobs disabled.");
    return;
  }

  cron.schedule(
    env.TRIAL_ENGAGEMENT_CRON,
    async () => {
      try {
        const result = await runTrialEngagementDeliveries();
        logger.info(result, "Trial engagement delivery loop completed.");
      } catch (error) {
        logger.error({ error }, "Trial engagement delivery loop failed.");
      }
    },
    {
      timezone: env.MORNING_BRIEF_TIMEZONE
    }
  );

  logger.info(
    {
      cron: env.TRIAL_ENGAGEMENT_CRON,
      timezone: env.MORNING_BRIEF_TIMEZONE
    },
    "Registered trial engagement cron."
  );
}
