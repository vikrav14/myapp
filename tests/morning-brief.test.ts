import { describe, expect, it } from "vitest";

import { parseRssItems } from "../src/services/morning-brief-scraper.service.js";
import { buildPersonalizedMorningBriefMessage } from "../src/services/morning-brief-curation.service.js";
import {
  buildSuggestedTopicsPrompt,
  buildTopicSelectionPrompt,
  defaultTopicsForArchetype,
  isTopicConfirmation,
  isValidTopicSelection,
  parseTopicPreferenceCommand,
  parseTopicSelection
} from "../src/services/morning-brief-topics.service.js";
import type { CuratedMorningBrief } from "../src/types.js";

describe("morning brief topics", () => {
  it("parses topic selections from mixed input", () => {
    expect(parseTopicSelection("Traffic, Money, #LocalBuzz")).toEqual(["Traffic", "Money", "LocalBuzz"]);
    expect(isValidTopicSelection(parseTopicSelection("1 2 3 4"))).toBe(true);
    expect(buildTopicSelectionPrompt()).toContain("7:00");
  });

  it("parses my topics and update topics commands", () => {
    expect(parseTopicPreferenceCommand("my topics")?.type).toBe("show");
    expect(parseTopicPreferenceCommand("update topics Traffic Money Tech")?.type).toBe("update");
    expect(parseTopicPreferenceCommand("I spent 150 on food")).toBeNull();
  });

  it("maps archetypes to default topic suggestions", () => {
    expect(defaultTopicsForArchetype("Student Grind")).toEqual(["Traffic", "Money", "LocalBuzz"]);
    expect(defaultTopicsForArchetype("Corporate / Career")).toEqual(["Traffic", "Tech", "Money"]);
    expect(isTopicConfirmation("OK")).toBe(true);
    expect(isTopicConfirmation("Traffic Money Tech")).toBe(false);
    expect(buildSuggestedTopicsPrompt("Student Grind")).toContain("#Traffic #Money #LocalBuzz");
    expect(buildTopicSelectionPrompt()).toContain("7:00");
  });
});

describe("morning brief RSS parser", () => {
  it("extracts RSS items from XML", () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[Traffic alert in Port Louis]]></title>
          <link>https://example.com/story-1</link>
          <description>Major slowdown near the port.</description>
          <pubDate>Mon, 22 Jun 2026 06:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;

    const items = parseRssItems(xml, "https://example.com/rss");
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Traffic alert in Port Louis");
    expect(items[0]?.url).toBe("https://example.com/story-1");
  });
});

describe("morning brief personalization", () => {
  it("builds a digest with weather, traffic, and matched stories", () => {
    const curated: CuratedMorningBrief = {
      brief_date: "2026-06-22",
      weather_line: "Warm morning in Port Louis with light breeze.",
      traffic_line: "Ebene commute is slower than usual.",
      stories: [
        {
          topic: "Traffic",
          headline: "Port Louis bottleneck",
          summary: "Heavy queue near Caudan.",
          source: "lexpress.mu"
        },
        {
          topic: "Tech",
          headline: "New coworking space",
          summary: "Ebene adds another hub.",
          source: "defimedia.info"
        }
      ]
    };

    const message = buildPersonalizedMorningBriefMessage({
      firstName: "Ava",
      topics: ["Traffic", "LocalBuzz"],
      curated
    });

    expect(message).toContain("Morning Ava");
    expect(message).toContain("Weather:");
    expect(message).toContain("Port Louis bottleneck");
    expect(message).not.toContain("coworking space");
  });
});
