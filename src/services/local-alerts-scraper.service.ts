import { createHash } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import {
  DEFAULT_LOCAL_ALERT_RSS_FEEDS,
  LOCAL_ALERT_KEYWORDS,
  LOCAL_ALERT_LOOKBACK_HOURS
} from "./local-alerts.constants.js";
import { parseRssItems, type ScrapedNewsItem } from "./morning-brief-scraper.service.js";

export interface AlertCandidateArticle extends ScrapedNewsItem {
  matchedKeywords: string[];
}

function resolveAlertFeedUrls(): string[] {
  const configured = env.LOCAL_ALERT_RSS_FEEDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : DEFAULT_LOCAL_ALERT_RSS_FEEDS;
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function findMatchedKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  return LOCAL_ALERT_KEYWORDS.filter((keyword) => normalized.includes(normalizeText(keyword)));
}

function isRecentEnough(publishedAt: string | null): boolean {
  if (!publishedAt) {
    return true;
  }

  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    return true;
  }

  const cutoff = Date.now() - LOCAL_ALERT_LOOKBACK_HOURS * 60 * 60 * 1000;
  return published.getTime() >= cutoff;
}

export function filterAlertCandidates(articles: ScrapedNewsItem[]): AlertCandidateArticle[] {
  const candidates: AlertCandidateArticle[] = [];

  for (const article of articles) {
    if (!isRecentEnough(article.publishedAt)) {
      continue;
    }

    const haystack = `${article.title} ${article.summary}`;
    const matchedKeywords = findMatchedKeywords(haystack);
    if (matchedKeywords.length === 0) {
      continue;
    }

    candidates.push({
      ...article,
      matchedKeywords
    });
  }

  return candidates;
}

export function buildAlertFingerprint(article: ScrapedNewsItem): string {
  const basis = `${article.source}|${article.title}|${article.url}`.toLowerCase().trim();
  return createHash("sha256").update(basis).digest("hex");
}

export async function scrapeAlertCandidates(): Promise<AlertCandidateArticle[]> {
  const feeds = resolveAlertFeedUrls();
  const articles: ScrapedNewsItem[] = [];

  for (const url of feeds) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "MauriLocalAlerts/1.0"
        }
      });

      if (!response.ok) {
        logger.warn({ url, status: response.status }, "Local alert RSS fetch failed.");
        continue;
      }

      const xml = await response.text();
      articles.push(...parseRssItems(xml, url));
    } catch (error) {
      logger.warn({ error, url }, "Local alert RSS fetch errored.");
    }
  }

  const unique = new Map<string, ScrapedNewsItem>();
  for (const article of articles) {
    const key = article.url || `${article.source}:${article.title}`;
    if (!unique.has(key)) {
      unique.set(key, article);
    }
  }

  return filterAlertCandidates([...unique.values()]);
}
