import { createApp } from "./app.js";
import { registerMorningBriefJobs } from "./jobs/morning-brief-jobs.js";
import { registerSquadJobs } from "./jobs/squad-jobs.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { logSecurityPostureWarnings } from "./lib/network-security.js";

const app = createApp();

app.listen(env.PORT, () => {
  registerSquadJobs();
  registerMorningBriefJobs();
  logSecurityPostureWarnings();
  logger.info({ port: env.PORT }, "Mauri backend listening.");
});
