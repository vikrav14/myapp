import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runUserMindReflectionBatch } from "../services/user-mind-snapshot.service.js";

export async function runUserMindReflectionJob(): Promise<void> {
  if (!env.USER_MIND_SNAPSHOTS_ENABLED) {
    return;
  }

  await runUserMindReflectionBatch();
}

export function registerUserMindJobs(): void {
  if (!env.USER_MIND_SNAPSHOTS_ENABLED) {
    logger.info("User mind reflection jobs disabled.");
    return;
  }

  cron.schedule(
    env.USER_MIND_REFLECT_CRON,
    () => {
      void runUserMindReflectionJob();
    },
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      reflectCron: env.USER_MIND_REFLECT_CRON,
      lookbackDays: env.USER_MIND_LOOKBACK_DAYS,
      batchSize: env.USER_MIND_BATCH_SIZE
    },
    "User mind reflection jobs registered."
  );
}
