import cron from "node-cron";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { runMemoryResurfacingDeliveries } from "../services/memory-resurfacing.service.js";

export async function runMemoryResurfacing(): Promise<void> {
  if (!env.MEMORY_RESURFACING_ENABLED) {
    return;
  }

  await runMemoryResurfacingDeliveries();
}

export function registerMemoryResurfacingJobs(): void {
  if (!env.MEMORY_RESURFACING_ENABLED) {
    logger.info("Memory resurfacing jobs disabled.");
    return;
  }

  cron.schedule(
    env.MEMORY_RESURFACING_CRON,
    () => {
      void runMemoryResurfacing();
    },
    { timezone: env.MORNING_BRIEF_TIMEZONE }
  );

  logger.info(
    {
      timezone: env.MORNING_BRIEF_TIMEZONE,
      cron: env.MEMORY_RESURFACING_CRON
    },
    "Memory resurfacing jobs registered."
  );
}
