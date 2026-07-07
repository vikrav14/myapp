import cron from "node-cron";

import { env } from "../lib/env.js";
import { scheduleCronJobSafely } from "../lib/cron-safe.js";
import { logger } from "../lib/logger.js";
import { runEveningRelationshipDeliveries } from "../services/relationship-engagement.service.js";

export async function runRelationshipEveningJob(): Promise<void> {
  if (!env.RELATIONSHIP_ENGAGEMENT_ENABLED) {
    return;
  }

  const result = await runEveningRelationshipDeliveries();
  logger.info(result, "Relationship evening ping loop completed.");
}

export function registerRelationshipEngagementJobs(): void {
  if (!env.RELATIONSHIP_ENGAGEMENT_ENABLED) {
    logger.info("Relationship engagement jobs disabled.");
    return;
  }

  cron.schedule(
    env.RELATIONSHIP_EVENING_CRON,
    scheduleCronJobSafely("relationship_evening_ping", runRelationshipEveningJob),
    {
      timezone: env.MORNING_BRIEF_TIMEZONE
    }
  );

  logger.info(
    {
      cron: env.RELATIONSHIP_EVENING_CRON,
      timezone: env.MORNING_BRIEF_TIMEZONE
    },
    "Registered relationship evening ping cron."
  );
}
