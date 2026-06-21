import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger.js";

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
    logger.info(
      {
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      },
      "Request completed."
    );
  });

  next();
}
