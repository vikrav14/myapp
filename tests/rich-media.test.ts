import { describe, expect, it } from "vitest";

import {
  buildSundayCardSvg,
  buildWelcomeCardSvg,
  shouldSendSundayReportImage,
  signSundayCardToken,
  verifySundayCardToken
} from "../src/services/rich-media.service.js";
import { buildPaymentCtaInteractive } from "../src/services/whatsapp-interactive.service.js";
import type { WeeklyDiagnosticSummary } from "../src/types.js";

function summary(overrides: Partial<WeeklyDiagnosticSummary> = {}): WeeklyDiagnosticSummary {
  return {
    window: { week_start: "2026-06-16T00:00:00.000Z", week_end: "2026-06-22T23:59:59.999Z" },
    finance: { total_spent: 1200, entry_count: 3, top_category: "Food" },
    habits: { total_logs: 4, successful_logs: 3, success_rate: 0.75, total_minutes: 180, top_activity: "Study" },
    todos: { created_count: 2, completed_count: 1, open_count: 1 },
    emotions: { average_anxiety: 3.2, latest_anxiety: 3, dominant_driver: "work" },
    momentum_score: 72,
    trial_cliffhanger: false,
    ...overrides
  };
}

describe("rich media service", () => {
  it("builds welcome and sunday SVG cards", () => {
    const welcome = buildWelcomeCardSvg({ firstName: "Vik" });
    const sunday = buildSundayCardSvg({
      firstName: "Vik",
      summary: summary(),
      weeklyFocus: "one boundary rep"
    });

    expect(welcome).toContain("Vik");
    expect(welcome).toContain("Smart advice");
    expect(sunday).toContain("Momentum 72/100");
    expect(sunday).toContain("roast me");
  });

  it("signs and verifies sunday card tokens", () => {
    const token = signSundayCardToken({
      userId: "11111111-1111-4111-8111-111111111111",
      weekStart: "2026-06-16T00:00:00.000Z"
    });

    expect(token).toBeTruthy();
    expect(verifySundayCardToken(token!)).toEqual({
      userId: "11111111-1111-4111-8111-111111111111",
      weekStart: "2026-06-16T00:00:00.000Z"
    });
  });

  it("skips sunday image on ghost weeks", () => {
    expect(
      shouldSendSundayReportImage({
        summary: summary({
          finance: { total_spent: 0, entry_count: 0, top_category: null },
          habits: { total_logs: 0, successful_logs: 0, success_rate: 0, total_minutes: 0, top_activity: null },
          todos: { created_count: 0, completed_count: 0, open_count: 0 },
          emotions: { average_anxiety: null, latest_anxiety: null, dominant_driver: null },
          momentum_score: 20
        }),
        priorReportCount: 2,
        messageCountThisWeek: 0
      })
    ).toBe(false);
  });
});

describe("payment CTA interactive", () => {
  it("builds a WhatsApp cta_url payload shape", () => {
    const interactive = buildPaymentCtaInteractive({
      provider: "juice",
      firstName: "Ava",
      amountRs: 200,
      checkoutUrl: "https://secure.peachpayments.com/checkout?checkoutId=abc",
      variant: "locked"
    });

    expect(interactive.ctaUrl?.displayText).toBe("Pay with Juice");
    expect(interactive.footer).toContain("Reply pay anytime");
    expect(interactive.body).toContain("Rs 200");
  });
});
