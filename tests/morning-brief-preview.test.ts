import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDailyBriefRunByDate = vi.fn();

vi.mock("../src/services/morning-brief-run.service.js", () => ({
  getDailyBriefRunByDate: mockGetDailyBriefRunByDate,
  todayBriefDate: () => "2026-06-22",
  parseCuratedMorningBrief: (payload: Record<string, unknown> | null) => {
    if (!payload) {
      return null;
    }

    return {
      brief_date: String(payload.brief_date ?? ""),
      weather_line: String(payload.weather_line ?? ""),
      traffic_line: String(payload.traffic_line ?? ""),
      stories: Array.isArray(payload.stories) ? payload.stories : []
    };
  }
}));

const { buildOnboardingPreviewBrief } = await import("../src/services/morning-brief-preview.service.js");

describe("buildOnboardingPreviewBrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses today's curated brief when available", async () => {
    mockGetDailyBriefRunByDate.mockResolvedValue({
      curated_payload: {
        brief_date: "2026-06-22",
        weather_line: "Sunny in Port Louis.",
        traffic_line: "Ebene is slow.",
        stories: [
          {
            topic: "Traffic",
            headline: "Port Louis bottleneck",
            summary: "Heavy queue near Caudan.",
            source: "lexpress.mu"
          }
        ]
      }
    });

    const preview = await buildOnboardingPreviewBrief({
      firstName: "Ava",
      archetype: "Student Grind",
      topics: ["Traffic", "Money", "LocalBuzz"]
    });

    expect(preview).toContain("live preview");
    expect(preview).toContain("Port Louis bottleneck");
    expect(preview).toContain("Morning Ava");
  });

  it("falls back to archetype preview samples when no curated brief exists", async () => {
    mockGetDailyBriefRunByDate.mockResolvedValue(null);

    const preview = await buildOnboardingPreviewBrief({
      firstName: "Ava",
      archetype: "Student Grind",
      topics: ["Traffic", "Money", "LocalBuzz"]
    });

    expect(preview).toContain("preview of your 7:00 vibe check");
    expect(preview).toContain("Port Louis commute check");
    expect(preview).toContain("Budget reality check");
  });
});
