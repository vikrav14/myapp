import express from "express";
import type { NextFunction, Request, Response } from "express";

import { registerSquadJobs } from "./jobs/squad-jobs.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { paymentsRouter, paymentWebhooksRouter } from "./routes/payments.js";
import { reportsRouter } from "./routes/reports.js";
import { whatsappRouter } from "./routes/whatsapp.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    ok: true,
    service: "mauri-backend",
    environment: env.NODE_ENV
  });
});

app.use("/internal/payments", paymentsRouter);
app.use("/webhooks/payments", paymentWebhooksRouter);
app.use("/internal/reports", reportsRouter);
app.use("/webhooks/whatsapp", whatsappRouter);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error";
  logger.error({ error }, "Unhandled application error.");
  response.status(500).json({ ok: false, error: message });
});

app.listen(env.PORT, () => {
  registerSquadJobs();
  logger.info({ port: env.PORT }, "Mauri backend listening.");
});
