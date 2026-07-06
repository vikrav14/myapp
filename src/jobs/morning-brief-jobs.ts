import cron from "node-cron";

import { scheduleCronJobSafely } from "../lib/cron-safe.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { curateMorningBrief } from "../services/morning-brief-curation.service.js";
import { deliverMorningBriefRun } from "../services/morning-brief-delivery.service.js";
import {
  ensureDailyBriefRun,
  getDailyBriefRunByDate,
  markDailyBriefFailed,
  todayBriefDate,
  updateDailyBriefRun
} from "../services/morning-brief-run.service.js";
import { scrapeMorningBriefSources } from "../services/morning-brief-scraper.service.js";

export async function runMorningBriefScrape(): Promise<void> {
  if (!env.MORNING_BRIEF_ENABLED) {
    return;
  }

  const briefDate = todayBriefDate();
  const run = await ensureDailyBriefRun(briefDate);

  if (run.status === "curated" || run.status === "delivering" || run.status === "delivered") {
    logger.info({ briefDate, status: run.status }, "Morning brief scrape skipped; run already advanced.");
    return;
  }

  try {
    const scrape = await scrapeMorningBriefSources();
    await updateDailyBriefRun(run.id, {
      status: "scraped",
      scrape_payload: scrape,
      weather_snapshot: scrape.weather,
      traffic_snapshot: scrape.traffic,
      scraped_at: new Date().toISOString(),
      error_message: null
    });
    logger.info(
      { briefDate, articleCount: scrape.articles.length, feedCount: scrape.feeds.length },
      "Morning brief scrape completed."
    );
  } catch (error) {
    await markDailyBriefFailed(run.id, error instanceof Error ? error.message : "scrape failed");
    logger.error({ error, briefDate }, "Morning brief scrape failed.");
  }
}

export async function runMorningBriefCuration(): Promise<void> {
  if (!env.MORNING_BRIEF_ENABLED) {
    return;
  }

  const briefDate = todayBriefDate();
  const run = await getDailyBriefRunByDate(briefDate);
  if (!run) {
    logger.warn({ briefDate }, "Morning brief curation skipped; no run found.");
    return;
  }

  if (run.status === "curated" || run.status === "delivering" || run.status === "delivered") {
    return;
  }

  let activeRun = run;
  if (activeRun.status === "pending_scrape") {
    await runMorningBriefScrape();
    const refreshed = await getDailyBriefRunByDate(briefDate);
    if (!refreshed || refreshed.status !== "scraped") {
      return;
    }
    activeRun = refreshed;
  } else if (activeRun.status !== "scraped") {
    return;
  }

  const scrapePayload = activeRun.scrape_payload;
  if (!scrapePayload || !Array.isArray((scrapePayload as { articles?: unknown }).articles)) {
    await markDailyBriefFailed(activeRun.id, "Missing scrape payload for curation.");
    return;
  }

  try {
    await updateDailyBriefRun(activeRun.id, { status: "curating" });
    const curated = await curateMorningBrief({
      briefDate,
      scrape: scrapePayload as unknown as Awaited<ReturnType<typeof scrapeMorningBriefSources>>
    });

    await updateDailyBriefRun(activeRun.id, {
      status: "curated",
      curated_payload: curated,
      curated_at: new Date().toISOString(),
      error_message: null
    });
    logger.info({ briefDate, storyCount: curated.stories.length }, "Morning brief curation completed.");
  } catch (error) {
    await markDailyBriefFailed(activeRun.id, error instanceof Error ? error.message : "curation failed");
    logger.error({ error, briefDate }, "Morning brief curation failed.");
  }
}

export async function runMorningBriefDelivery(): Promise<void> {
  if (!env.MORNING_BRIEF_ENABLED) {
    return;
  }

  const briefDate = todayBriefDate();
  let run = await getDailyBriefRunByDate(briefDate);
  if (!run) {
    logger.warn({ briefDate }, "Morning brief delivery skipped; no run found.");
    return;
  }

  if (run.status === "delivered") {
    return;
  }

  if (run.status !== "curated") {
    await runMorningBriefCuration();
    run = await getDailyBriefRunByDate(briefDate);
    if (!run || run.status !== "curated") {
      return;
    }
  }

  try {
    await updateDailyBriefRun(run.id, { status: "delivering" });
    const result = await deliverMorningBriefRun({ run });
    await updateDailyBriefRun(run.id, {
      status: "delivered",
      delivered_at: new Date().toISOString(),
      error_message: null
    });
    logger.info({ briefDate, ...result }, "Morning brief delivery completed.");
  } catch (error) {
    await markDailyBriefFailed(run.id, error instanceof Error ? error.message : "delivery failed");
    logger.error({ error, briefDate }, "Morning brief delivery failed.");
  }
}

export function registerMorningBriefJobs(): void {
  if (!env.MORNING_BRIEF_ENABLED) {
    logger.info("Morning brief jobs disabled.");
    return;
  }

  const timezone = env.MORNING_BRIEF_TIMEZONE;

  cron.schedule(
    env.MORNING_BRIEF_SCRAPE_CRON,
    scheduleCronJobSafely("morning_brief_scrape", runMorningBriefScrape),
    { timezone }
  );

  cron.schedule(
    env.MORNING_BRIEF_CURATE_CRON,
    scheduleCronJobSafely("morning_brief_curate", runMorningBriefCuration),
    { timezone }
  );

  cron.schedule(
    env.MORNING_BRIEF_DELIVER_CRON,
    scheduleCronJobSafely("morning_brief_delivery", runMorningBriefDelivery),
    { timezone }
  );

  logger.info(
    {
      timezone,
      scrapeCron: env.MORNING_BRIEF_SCRAPE_CRON,
      curateCron: env.MORNING_BRIEF_CURATE_CRON,
      deliverCron: env.MORNING_BRIEF_DELIVER_CRON
    },
    "Morning brief jobs registered."
  );
}
