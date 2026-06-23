import { createApp } from "./app.js";
import { registerCalendarJobs } from "./jobs/calendar-jobs.js";
import { registerMemoryResurfacingJobs } from "./jobs/memory-resurfacing-jobs.js";
import { registerMorningBriefJobs } from "./jobs/morning-brief-jobs.js";
import { registerReminderJobs } from "./jobs/reminder-jobs.js";
import { registerSquadJobs } from "./jobs/squad-jobs.js";
import { registerTrialEngagementJobs } from "./jobs/trial-engagement-jobs.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { logSecurityPostureWarnings } from "./lib/network-security.js";

const app = createApp();

app.listen(env.PORT, () => {
  registerSquadJobs();
  registerMorningBriefJobs();
  registerReminderJobs();
  registerCalendarJobs();
  registerMemoryResurfacingJobs();
  registerTrialEngagementJobs();
  logSecurityPostureWarnings();
  logger.info({ port: env.PORT }, "Mauri backend listening.");
});
