import { logger } from "./logger.js";

export async function runCronJobSafely(jobName: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (error) {
    logger.error({ error, jobName }, "Scheduled job failed.");
  }
}

export function scheduleCronJobSafely(
  jobName: string,
  job: () => Promise<void>
): () => Promise<void> {
  return () => runCronJobSafely(jobName, job);
}
