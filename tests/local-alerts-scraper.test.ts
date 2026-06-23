import { describe, expect, it } from "vitest";

import { filterAlertCandidates, buildAlertFingerprint } from "../src/services/local-alerts-scraper.service.js";
import type { ScrapedNewsItem } from "../src/services/morning-brief-scraper.service.js";

describe("filterAlertCandidates", () => {
  it("keeps articles that match urgent local keywords", () => {
    const articles: ScrapedNewsItem[] = [
      {
        title: "Avis de grosses pluies: plusieurs écoles fermées demain",
        summary: "Le ministère annonce la fermeture des écoles primaires dans certaines zones.",
        url: "https://example.com/alert",
        source: "lemauricien.com",
        publishedAt: new Date().toISOString()
      },
      {
        title: "Football match preview",
        summary: "Club rivalry continues this weekend.",
        url: "https://example.com/sport",
        source: "lemauricien.com",
        publishedAt: new Date().toISOString()
      }
    ];

    const candidates = filterAlertCandidates(articles);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.matchedKeywords.length).toBeGreaterThan(0);
    expect(candidates[0]?.title).toContain("grosses pluies");
  });
});

describe("buildAlertFingerprint", () => {
  it("creates a stable fingerprint for dedup", () => {
    const article: ScrapedNewsItem = {
      title: "Schools closed",
      summary: "Heavy rain warning",
      url: "https://example.com/1",
      source: "defimedia.info",
      publishedAt: null
    };

    expect(buildAlertFingerprint(article)).toEqual(buildAlertFingerprint(article));
  });
});
