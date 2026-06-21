import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import * as ipaddr from "ipaddr.js";

import { env } from "./env.js";
import { logger } from "./logger.js";
import { getRequestId } from "./request-tracing.js";

type TrustProxySetting = boolean | number | string;

interface ParsedAllowlistRule {
  original: string;
  kind: "single" | "cidr";
  addr: ipaddr.IPv4 | ipaddr.IPv6;
  range?: number | undefined;
}

function normalizeIp(ip: string): string {
  return ip.trim().replace(/^\:\:ffff:/i, "");
}

function parseAllowlistRules(value: string | undefined): ParsedAllowlistRule[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes("/")) {
        const [addr, range] = ipaddr.parseCIDR(entry);
        return {
          original: entry,
          kind: "cidr" as const,
          addr,
          range
        };
      }

      return {
        original: entry,
        kind: "single" as const,
        addr: ipaddr.parse(entry)
      };
    });
}

function clientIpFromRequest(request: Request): string | null {
  const candidate = request.ip || request.socket.remoteAddress || null;
  return candidate ? normalizeIp(candidate) : null;
}

function isIpAllowed(ip: string, rules: ParsedAllowlistRule[]): boolean {
  if (!rules.length) {
    return true;
  }

  if (!ipaddr.isValid(ip)) {
    return false;
  }

  const parsedIp = ipaddr.process(ip);
  return rules.some((rule) => {
    if (rule.kind === "single") {
      return parsedIp.toNormalizedString() === ipaddr.process(rule.addr.toString()).toNormalizedString();
    }

    return parsedIp.match([rule.addr, rule.range ?? 0]);
  });
}

export function parseTrustProxySetting(value: unknown): TrustProxySetting | false {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }

    if (/^\d+$/.test(normalized)) {
      return Number(normalized);
    }

    return value;
  }

  return false;
}

export function createIpAllowlistMiddleware(input: {
  label: string;
  allowlist: string | undefined;
}): RequestHandler {
  const rules = parseAllowlistRules(input.allowlist);

  return (request: Request, response: Response, next: NextFunction) => {
    if (!rules.length) {
      next();
      return;
    }

    const clientIp = clientIpFromRequest(request);
    if (clientIp && isIpAllowed(clientIp, rules)) {
      next();
      return;
    }

    const requestId = getRequestId(response);
    logger.warn(
      {
        requestId,
        clientIp,
        label: input.label,
        path: request.originalUrl
      },
      "Blocked request from disallowed IP."
    );

    response.status(403).json({
      ok: false,
      error: `IP not allowed for ${input.label}.`,
      requestId
    });
  };
}

export function createSecurityHeadersMiddleware(): RequestHandler {
  if (!env.ENABLE_SECURITY_HEADERS) {
    return (_request, _response, next) => next();
  }

  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  });
}

export function getSecurityPostureSummary(): {
  trustProxyConfigured: boolean;
  securityHeadersEnabled: boolean;
  adminAllowlistConfigured: boolean;
  paymentWebhookAllowlistConfigured: boolean;
  whatsappWebhookAllowlistConfigured: boolean;
  peachSignatureEnabled: boolean;
  outboundRetryEnabled: boolean;
  warnings: string[];
} {
  const summary = {
    trustProxyConfigured: parseTrustProxySetting(env.TRUST_PROXY) !== false,
    securityHeadersEnabled: env.ENABLE_SECURITY_HEADERS,
    adminAllowlistConfigured: Boolean(env.ADMIN_IP_ALLOWLIST?.trim()),
    paymentWebhookAllowlistConfigured: Boolean(env.PAYMENT_WEBHOOK_IP_ALLOWLIST?.trim()),
    whatsappWebhookAllowlistConfigured: Boolean(env.WHATSAPP_WEBHOOK_IP_ALLOWLIST?.trim()),
    peachSignatureEnabled: Boolean(env.PEACH_WEBHOOK_SECRET),
    outboundRetryEnabled: env.OUTBOUND_RETRY_MAX_ATTEMPTS > 0,
    warnings: [] as string[]
  };

  if (env.NODE_ENV === "production") {
    if (!summary.trustProxyConfigured) {
      summary.warnings.push("TRUST_PROXY is not configured for production.");
    }

    if (!summary.adminAllowlistConfigured) {
      summary.warnings.push("ADMIN_IP_ALLOWLIST is not configured.");
    }

    if (!summary.paymentWebhookAllowlistConfigured) {
      summary.warnings.push("PAYMENT_WEBHOOK_IP_ALLOWLIST is not configured.");
    }

    if (!summary.whatsappWebhookAllowlistConfigured) {
      summary.warnings.push("WHATSAPP_WEBHOOK_IP_ALLOWLIST is not configured.");
    }

    if (!summary.peachSignatureEnabled) {
      summary.warnings.push("PEACH_WEBHOOK_SECRET is not configured.");
    }
  }

  return summary;
}

export function logSecurityPostureWarnings(): void {
  const summary = getSecurityPostureSummary();
  for (const warning of summary.warnings) {
    logger.warn({ warning }, "Security posture warning.");
  }
}
