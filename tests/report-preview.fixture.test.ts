import { describe, expect, it } from "vitest";

import { buildVikSilentWeekPreview } from "../src/services/report-preview.fixture.js";

describe("Vik report preview fixture", () => {
  it("builds silent-week HTML with Vik story and low momentum", () => {
    const { html, summary, reportText } = buildVikSilentWeekPreview();

    expect(summary.momentum_score).toBe(22);
    expect(reportText).toContain("wedding loan");
    expect(html).toContain("Vik's week");
    expect(html).toContain("22");
    expect(html).toContain("family-money moment");
    expect(html).toContain("roast me");
  });
});
