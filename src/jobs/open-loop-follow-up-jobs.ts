import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runOpenLoopFollowUpDeliveries } from "../services/open-loop-follow-up.service.js";

export async function runOpenLoopFollowUpJob(): Promise<void> {
  if (!env.OPEN_LOOP_FOLLOWUPS_ENABLED) {
    return;
  }

  await runOpenLoopFollowUpDeliveries();
}

export function registerOpenLoopFollowUpJobs(): void {
  if (!env.OPEN_LOOP_FOLLOWUPS_ENABLED) {
    logger.info("Open-loop follow-up jobs disabled.");
    return;
  }

  cron.schedule(
    env.OPEN_LOOP_FOLLOWUP_CRON,
    () => {
      void runOpenLoopFollowUpJob();
    },
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      cron: env.OPEN_LOOP_FOLLOWUP_CRON,
      hour: env.OPEN_LOOP_FOLLOWUP_HOUR
    },
    "Open-loop follow-up jobs registered."
  );
}
