import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import {
  DEFAULT_MORNING_BRIEF_RSS_FEEDS,
  MAURITIUS_TRAFFIC_CORRIDORS
} from "./morning-brief.constants.js";
import {
  fetchMauritiusWeatherSummary,
  type MauritiusWeatherSummary
} from "./mauritius-weather.service.js";
import { fetchTrafficCorridors } from "./mauritius-traffic.service.js";

export interface ScrapedNewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface MorningBriefScrapeResult {
  fetchedAt: string;
  feeds: Array<{
    url: string;
    status: "ok" | "error";
    itemCount: number;
    error?: string | undefined;
  }>;
  articles: ScrapedNewsItem[];
  weather: MauritiusWeatherSummary | null;
  traffic: Record<string, unknown> | null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRssItems(xml: string, sourceUrl: string): ScrapedNewsItem[] {
  const items: ScrapedNewsItem[] = [];
  const source = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemBlocks.slice(0, 20)) {
    const title = stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = decodeXmlEntities(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    const description = stripHtml(
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ??
        block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1] ??
        ""
    );
    const publishedAt = decodeXmlEntities(block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "").trim();

    if (!title) {
      continue;
    }

    items.push({
      title,
      summary: description || title,
      url: link || sourceUrl,
      source,
      publishedAt: publishedAt || null
    });
  }

  return items;
}

function resolveRssFeedUrls(): string[] {
  const configured = env.MORNING_BRIEF_RSS_FEEDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : DEFAULT_MORNING_BRIEF_RSS_FEEDS;
}

async function fetchWeatherSnapshot(): Promise<MauritiusWeatherSummary | null> {
  return fetchMauritiusWeatherSummary(env.MORNING_BRIEF_TIMEZONE);
}

async function fetchTrafficSnapshot(): Promise<Record<string, unknown> | null> {
  if (!env.GOOGLE_MAPS_API_KEY?.trim()) {
    return {
      configured: false,
      note: "GOOGLE_MAPS_API_KEY not configured."
    };
  }

  try {
    const corridors = await fetchTrafficCorridors(
      MAURITIUS_TRAFFIC_CORRIDORS.map((corridor) => ({
        label: corridor.label,
        origin: corridor.origin,
        destination: corridor.destination
      }))
    );

    return {
      configured: true,
      corridors,
      fetched_at: new Date().toISOString()
    };
  } catch (error) {
    logger.warn({ error }, "Morning brief traffic fetch failed.");
    return null;
  }
}

export async function scrapeMorningBriefSources(): Promise<MorningBriefScrapeResult> {
  const feeds = resolveRssFeedUrls();
  const feedResults: MorningBriefScrapeResult["feeds"] = [];
  const articles: ScrapedNewsItem[] = [];

  for (const url of feeds) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "MauriMorningBrief/1.0"
        }
      });

      if (!response.ok) {
        feedResults.push({
          url,
          status: "error",
          itemCount: 0,
          error: `HTTP ${response.status}`
        });
        continue;
      }

      const xml = await response.text();
      const parsed = parseRssItems(xml, url);
      articles.push(...parsed);
      feedResults.push({
        url,
        status: "ok",
        itemCount: parsed.length
      });
    } catch (error) {
      feedResults.push({
        url,
        status: "error",
        itemCount: 0,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  const [weather, traffic] = await Promise.all([fetchWeatherSnapshot(), fetchTrafficSnapshot()]);

  return {
    fetchedAt: new Date().toISOString(),
    feeds: feedResults,
    articles: articles.slice(0, 40),
    weather,
    traffic
  };
}
