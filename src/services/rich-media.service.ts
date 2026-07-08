import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { MauriUser, WeeklyDiagnosticSummary } from "../types.js";
import { weekActivityScore } from "./weekly-report-feedback.service.js";

export const MAURI_TYPED_ESCAPE_HATCH =
  "Or just tell me in your own words — typing always works.";

function mediaSigningSecret(): string | null {
  return env.INTERNAL_ADMIN_API_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

export function resolvePublicBaseUrl(): string | null {
  const candidate = env.MAURI_PUBLIC_BASE_URL?.trim() || env.PAYMENT_CALLBACK_BASE_URL?.trim();
  if (!candidate) {
    return null;
  }

  return candidate.replace(/\/$/, "");
}

export function isRichMediaEnabled(): boolean {
  return env.WHATSAPP_RICH_MEDIA_ENABLED;
}

export function resolveWelcomeImageUrl(): string | null {
  if (!isRichMediaEnabled()) {
    return null;
  }

  const override = env.MAURI_WELCOME_IMAGE_URL?.trim();
  if (override) {
    return override;
  }

  const base = resolvePublicBaseUrl();
  if (!base) {
    return null;
  }

  return `${base}/media/welcome.png`;
}

export function signSundayCardToken(input: { userId: string; weekStart: string }): string | null {
  const secret = mediaSigningSecret();
  if (!secret) {
    return null;
  }

  const payload = JSON.stringify({ userId: input.userId, weekStart: input.weekStart });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySundayCardToken(token: string): { userId: string; weekStart: string } | null {
  const secret = mediaSigningSecret();
  if (!secret) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  const provided = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      userId?: string;
      weekStart?: string;
    };

    if (!parsed.userId || !parsed.weekStart) {
      return null;
    }

    return {
      userId: parsed.userId,
      weekStart: parsed.weekStart
    };
  } catch {
    return null;
  }
}

export function buildSundayCardImageUrl(input: { userId: string; weekStart: string }): string | null {
  if (!isRichMediaEnabled()) {
    return null;
  }

  const base = resolvePublicBaseUrl();
  const token = signSundayCardToken(input);
  if (!base || !token) {
    return null;
  }

  return `${base}/media/sunday/${token}.png`;
}

export function buildReportWebUrl(input: { userId: string; weekStart: string }): string | null {
  const base = resolvePublicBaseUrl();
  const token = signSundayCardToken(input);
  if (!base || !token) {
    return null;
  }

  return `${base}/report/${token}`;
}

export function shouldSendSundayReportImage(input: {
  summary: WeeklyDiagnosticSummary;
  priorReportCount: number;
  messageCountThisWeek: number;
}): boolean {
  if (!isRichMediaEnabled() || !resolvePublicBaseUrl()) {
    return false;
  }

  const activity = weekActivityScore(input.summary);
  if (activity === 0 && input.messageCountThisWeek < 2) {
    return false;
  }

  return input.priorReportCount === 0 || activity >= 2 || input.priorReportCount >= 2;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildWelcomeCardSvg(input?: { firstName?: string | null }): string {
  const name = input?.firstName?.trim() || "there";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f3d2e"/>
      <stop offset="100%" stop-color="#1f6b4d"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)" rx="48"/>
  <text x="72" y="140" fill="#d8f3e6" font-size="42" font-family="Arial, sans-serif">Hey ${escapeXml(name)} 👋</text>
  <text x="72" y="220" fill="#ffffff" font-size="64" font-weight="700" font-family="Arial, sans-serif">Mauri</text>
  <text x="72" y="290" fill="#c9ead8" font-size="34" font-family="Arial, sans-serif">Your week in WhatsApp — tuned to how you live</text>
  <text x="72" y="420" fill="#ffffff" font-size="36" font-family="Arial, sans-serif">🌅 7am brief</text>
  <text x="72" y="500" fill="#ffffff" font-size="36" font-family="Arial, sans-serif">📊 Sunday roast / hype</text>
  <text x="72" y="580" fill="#ffffff" font-size="36" font-family="Arial, sans-serif">🧠 Smart advice when you're stuck</text>
  <text x="72" y="660" fill="#ffffff" font-size="36" font-family="Arial, sans-serif">🎙️ Voice notes welcome</text>
  <text x="72" y="820" fill="#d8f3e6" font-size="30" font-family="Arial, sans-serif">Rough is fine — type or talk below</text>
  <text x="72" y="980" fill="#9fd9bc" font-size="28" font-family="Arial, sans-serif">🦤 Personal stuff stays private</text>
</svg>`;
}

export function buildSundayCardSvg(input: {
  firstName?: string | null;
  summary: WeeklyDiagnosticSummary;
  weeklyFocus?: string | null;
}): string {
  const name = input.firstName?.trim() || "there";
  const spend =
    input.summary.finance.entry_count > 0
      ? `Rs ${Math.round(input.summary.finance.total_spent)} tracked`
      : "Quiet week on spend";
  const habits =
    input.summary.habits.total_logs > 0
      ? `${input.summary.habits.successful_logs}/${input.summary.habits.total_logs} habit wins`
      : "Habits still warming up";
  const mood =
    input.summary.emotions.average_anxiety !== null
      ? `Mood avg ${input.summary.emotions.average_anxiety}/5`
      : "Mood check-ins open";
  const focus = truncate(input.weeklyFocus?.trim() || "One small win each day", 42);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#14213d"/>
      <stop offset="100%" stop-color="#1d3557"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)" rx="48"/>
  <text x="72" y="120" fill="#dbeafe" font-size="34" font-family="Arial, sans-serif">Sunday check-in</text>
  <text x="72" y="190" fill="#ffffff" font-size="56" font-weight="700" font-family="Arial, sans-serif">${escapeXml(name)}'s week</text>
  <text x="72" y="320" fill="#ffffff" font-size="40" font-family="Arial, sans-serif">Momentum ${input.summary.momentum_score}/100</text>
  <text x="72" y="410" fill="#e2e8f0" font-size="34" font-family="Arial, sans-serif">${escapeXml(spend)}</text>
  <text x="72" y="480" fill="#e2e8f0" font-size="34" font-family="Arial, sans-serif">${escapeXml(habits)}</text>
  <text x="72" y="550" fill="#e2e8f0" font-size="34" font-family="Arial, sans-serif">${escapeXml(mood)}</text>
  <text x="72" y="700" fill="#93c5fd" font-size="30" font-family="Arial, sans-serif">This week's focus</text>
  <text x="72" y="760" fill="#ffffff" font-size="34" font-family="Arial, sans-serif">${escapeXml(focus)}</text>
  <text x="72" y="980" fill="#bfdbfe" font-size="28" font-family="Arial, sans-serif">Reply roast me, hype me, or tell me how it really felt</text>
</svg>`;
}

export async function renderSvgToPng(svg: string): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  } catch (error) {
    logger.warn({ error }, "Failed to render rich media SVG to PNG.");
    return null;
  }
}

export function buildWelcomeImagePayload(user: MauriUser): { url: string; caption: string } | null {
  const url = resolveWelcomeImageUrl();
  if (!url) {
    return null;
  }

  const name = user.first_name?.trim() || "there";
  return {
    url,
    caption: `Hey ${name} — Mauri here. Scan the card, then tell me about your life in your own words (voice note is perfect).`
  };
}

export function buildSundayImagePayload(input: {
  user: MauriUser;
  summary: WeeklyDiagnosticSummary;
  weekStart: string;
}): { url: string; caption: string } | null {
  const url = buildSundayCardImageUrl({ userId: input.user.id, weekStart: input.weekStart });
  if (!url) {
    return null;
  }

  return {
    url,
    caption: "Your week at a glance — full read in the next message. Roast me, hype me, or tell me how it really felt."
  };
}
