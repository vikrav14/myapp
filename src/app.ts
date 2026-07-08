import express from "express";
import type { NextFunction, Request, Response } from "express";

import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import {
  createIpAllowlistMiddleware,
  createSecurityHeadersMiddleware,
  parseTrustProxySetting
} from "./lib/network-security.js";
import { getRequestId, requestTracingMiddleware } from "./lib/request-tracing.js";
import { renderPrometheusMetrics, getMetricsSnapshot } from "./services/metrics.service.js";
import { supabase } from "./lib/supabase.js";
import { adminRouter } from "./routes/admin.js";
import { paymentsRouter, paymentWebhooksRouter } from "./routes/payments.js";
import { reportsRouter } from "./routes/reports.js";
import { handleSundayCardImageRequest, handleWelcomeImageRequest } from "./routes/media.js";
import { whatsappRouter } from "./routes/whatsapp.js";

export function createApp(): express.Express {
  const app = express();

  app.set("trust proxy", parseTrustProxySetting(env.TRUST_PROXY));
  app.use(requestTracingMiddleware);
  app.use(createSecurityHeadersMiddleware());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({
      ok: true,
      service: "mauri-backend",
      environment: env.NODE_ENV
    });
  });

  app.get("/ready", async (_request, response) => {
    const { error } = await supabase.from("users").select("*", { count: "exact", head: true });

    if (error) {
      response.status(503).json({
        ok: false,
        service: "mauri-backend",
        environment: env.NODE_ENV,
        ready: false,
        error: error.message
      });
      return;
    }

    response.status(200).json({
      ok: true,
      service: "mauri-backend",
      environment: env.NODE_ENV,
      ready: true
    });
  });

  app.get(
    "/metrics",
    createIpAllowlistMiddleware({ label: "metrics", allowlist: env.METRICS_IP_ALLOWLIST ?? env.ADMIN_IP_ALLOWLIST }),
    async (_request, response, next) => {
      try {
        const snapshot = await getMetricsSnapshot();
        response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
        response.status(200).send(renderPrometheusMetrics(snapshot));
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/media/welcome.png", handleWelcomeImageRequest);
  app.get("/media/sunday/:token.png", handleSundayCardImageRequest);

  app.use(
    "/internal/admin",
    createIpAllowlistMiddleware({ label: "internal admin", allowlist: env.ADMIN_IP_ALLOWLIST }),
    adminRouter
  );
  app.use(
    "/internal/payments",
    createIpAllowlistMiddleware({ label: "internal payments", allowlist: env.ADMIN_IP_ALLOWLIST }),
    paymentsRouter
  );
  app.use(
    "/internal/reports",
    createIpAllowlistMiddleware({ label: "internal reports", allowlist: env.ADMIN_IP_ALLOWLIST }),
    reportsRouter
  );
  app.use(
    "/webhooks/payments",
    createIpAllowlistMiddleware({ label: "payment webhooks", allowlist: env.PAYMENT_WEBHOOK_IP_ALLOWLIST }),
    paymentWebhooksRouter
  );
  app.use(
    "/webhooks/whatsapp",
    createIpAllowlistMiddleware({ label: "whatsapp webhooks", allowlist: env.WHATSAPP_WEBHOOK_IP_ALLOWLIST }),
    whatsappRouter
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    const requestId = getRequestId(response);
    logger.error({ error, requestId }, "Unhandled application error.");
    response.status(500).json({ ok: false, error: message, requestId });
  });

  return app;
}
