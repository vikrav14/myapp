import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger.js";
import { recordHttpRequest, resolveHttpRoute } from "./http-metrics.js";

export function getRequestId(response: Response): string | undefined {
  const requestId = response.locals.requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId : undefined;
}

export function requestTracingMiddleware(request: Request, response: Response, next: NextFunction): void {
  const headerRequestId = request.header("x-request-id");
  const requestId = headerRequestId?.trim() || randomUUID();
  const startedAt = Date.now();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);

  logger.info(
    {
      requestId,
      method: request.method,
      path: request.originalUrl
    },
    "Request started."
  );

  response.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    recordHttpRequest({
      method: request.method,
      route: resolveHttpRoute(request),
      statusCode: response.statusCode,
      durationMs
    });

    logger.info(
      {
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs
      },
      "Request completed."
    );
  });

  next();
}
