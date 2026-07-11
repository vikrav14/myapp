import { describe, expect, it } from "vitest";

import {
  buildActivePinLine,
  buildPersonalizedTrafficLine,
  buildStoryRelevanceLine,
  buildUserPulseContext,
  pickCommuteCorridor,
  rankStoriesForUser
} from "../src/services/morning-brief-pulse.service.js";
import { buildPersonalizedMorningBriefMessage } from "../src/services/morning-brief-curation.service.js";
import type { CuratedMorningBrief, MauriUser, UserMindFact } from "../src/types.js";

function fact(partial: Partial<UserMindFact> & Pick<UserMindFact, "category" | "fact_key" | "fact_value">): UserMindFact {
  return {
    id: "fact-1",
    user_id: "user-1",
    source: "test",
    confidence: 0.9,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
    ...partial
  };
}

function baseUser(overrides: Partial<MauriUser> = {}): MauriUser {
  return {
    id: "user-1",
    phone_number: "+23050000000",
    first_name: "Vik",
    last_name: null,
    archetype: "Corporate / Career",
    brief_focus: "commute and money",
    active_modules: ["career"],
    help_focus_primary: "personal_finance",
    help_focus_secondary: null,
    onboarding_state: "active",
    subscription_status: "Trial_Active",
    onboarding_completed_at: "2026-06-01T00:00:00.000Z",
    trial_ends_at: "2026-07-01T00:00:00.000Z",
    subscription_ends_at: null,
    morning_digest_enabled: true,
    topic_preferences: ["Traffic", "Money", "Tech"],
    payday_day_of_month: null,
    notification_pace: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

const curatedFixture: CuratedMorningBrief = {
  brief_date: "2026-06-22",
  weather_line: "Warm morning across Mauritius.",
  traffic_line: "Port Louis and Ebene corridors are tight.",
  stories: [
    {
      topic: "Traffic",
      headline: "Rose Hill queue builds toward Port Louis.",
      summary: "Peak slowdown on M1.",
      source: "lexpress.mu"
    },
    {
      topic: "Money",
      headline: "MCB raises fixed deposit rates.",
      summary: "Savers get a small bump.",
      source: "defimedia.info"
    },
    {
      topic: "Tech",
      headline: "Ebene hub adds another AI startup.",
      summary: "Cybercity hiring signal.",
      source: "lemauricien.com"
    },
    {
      topic: "LocalBuzz",
      headline: "Vacoas market hours shift for winter.",
      summary: "Local traders adjust.",
      source: "lemauricien.com"
    }
  ]
};

describe("morning brief pulse context", () => {
  it("picks a commute corridor from home and work zones", () => {
    const facts = [
      fact({ category: "location", fact_key: "area", fact_value: "Vacoas" }),
      fact({ category: "life_context", fact_key: "work", fact_value: "Office in Port Louis" })
    ];

    const corridor = pickCommuteCorridor(
      {
        configured: true,
        corridors: [
          {
            label: "Port Louis to Ebene",
            duration_text: "35 mins",
            duration_seconds: 2100,
            status: "OK"
          },
          {
            label: "Rose Hill to Port Louis",
            duration_text: "48 mins",
            duration_seconds: 2880,
            status: "OK"
          }
        ]
      },
      facts
    );

    expect(corridor?.label).toBe("Rose Hill to Port Louis");
  });

  it("builds a personalized traffic line with route hint", () => {
    const facts = [
      fact({ category: "location", fact_key: "area", fact_value: "Vacoas" }),
      fact({ category: "life_context", fact_key: "work", fact_value: "Port Louis" }),
      fact({ category: "stressors", fact_key: "commute", fact_value: "2 hours in traffic daily" })
    ];

    const line = buildPersonalizedTrafficLine({
      curatedTrafficLine: "Traffic not available right now.",
      trafficSnapshot: {
        configured: true,
        corridors: [
          {
            label: "Rose Hill to Port Louis",
            duration_text: "42 mins",
            duration_seconds: 2520,
            status: "OK"
          }
        ]
      },
      facts
    });

    expect(line).toContain("Rose Hill to Port Louis");
    expect(line).toContain("Vacoas");
  });

  it("falls back when live traffic is not available but user commutes", () => {
    const line = buildPersonalizedTrafficLine({
      curatedTrafficLine: "Traffic not available right now.",
      trafficSnapshot: { configured: false },
      facts: [fact({ category: "stressors", fact_key: "commute", fact_value: "daily drive to Ebene" })]
    });

    expect(line).toContain("leave 15 min early");
  });

  it("ranks money ahead of traffic for finance-focused users", () => {
    const facts = [
      fact({ category: "location", fact_key: "area", fact_value: "Vacoas" }),
      fact({ category: "goals", fact_key: "rent", fact_value: "rent due next week" })
    ];

    const ranked = rankStoriesForUser({
      curated: curatedFixture,
      topics: ["Traffic", "Money", "Tech"],
      user: baseUser(),
      facts
    });

    expect(ranked[0]?.topic).toBe("Money");
  });

  it("adds relevance lines and active pin in the composed pulse", () => {
    const facts = [
      fact({ category: "location", fact_key: "area", fact_value: "Vacoas" }),
      fact({ category: "stressors", fact_key: "commute", fact_value: "2 hours in traffic daily" }),
      fact({ category: "goals", fact_key: "rent", fact_value: "rent due next week" })
    ];

    const pulse = buildUserPulseContext({
      user: baseUser(),
      curated: curatedFixture,
      weatherSnapshot: {
        provider: "open-meteo",
        attribution: "Weather data by Open-Meteo.com",
        fetched_at: "2026-06-22T06:00:00.000Z",
        island_line: "Warm morning across Mauritius.",
        zones: []
      },
      trafficSnapshot: {
        configured: true,
        corridors: [
          {
            label: "Rose Hill to Port Louis",
            duration_text: "42 mins",
            duration_seconds: 2520,
            status: "OK"
          }
        ]
      },
      facts,
      openLoops: ["uncle loan follow-up"]
    });

    const message = buildPersonalizedMorningBriefMessage({
      firstName: "Vik",
      topics: ["Traffic", "Money", "Tech"],
      curated: curatedFixture,
      weatherLine: pulse.weatherLine,
      trafficLine: pulse.trafficLine,
      pulseStories: pulse.stories,
      activePinLine: pulse.activePinLine,
      pulseLabel: pulse.pulseLabel
    });

    expect(message).toContain("your 7am pulse (");
    expect(message).toContain("→");
    expect(message).toContain("📌 Still on your radar: uncle loan follow-up");
    expect(buildStoryRelevanceLine({
      story: curatedFixture.stories[1]!,
      user: baseUser(),
      facts
    })).toContain("runway");
    expect(buildActivePinLine(["uncle loan follow-up"])).toContain("uncle loan");
  });

  it("uses remote-worker traffic copy instead of corridor lines", () => {
    const facts = [
      fact({ category: "life_context", fact_key: "work", fact_value: "Remote for EU company" })
    ];

    const line = buildPersonalizedTrafficLine({
      curatedTrafficLine: "Port Louis and Ebene corridors are tight.",
      trafficSnapshot: {
        configured: true,
        corridors: [
          {
            label: "Rose Hill to Port Louis",
            duration_text: "42 mins",
            duration_seconds: 2520,
            status: "OK"
          }
        ]
      },
      facts
    });

    expect(line).toContain("Remote day");
  });
});
