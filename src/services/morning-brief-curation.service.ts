import { z } from "zod";

import { env } from "../lib/env.js";
import { sanitizeGeminiResponseSchema } from "../lib/gemini-schema.js";
import { MAURI_ENGLISH_ONLY_LANGUAGE_RULE } from "../lib/mauri-voice.js";
import { parseStructuredJson } from "../schemas/extraction.js";
import type { CuratedMorningBrief, MorningBriefTopicKey } from "../types.js";
import type { MorningBriefScrapeResult } from "./morning-brief-scraper.service.js";
import {
  MAURITIUS_WEATHER_FALLBACK_LINE
} from "./mauritius-weather.service.js";
import { MORNING_BRIEF_TOPIC_KEYS } from "./morning-brief.constants.js";

const curatedStorySchema = z.object({
  topic: z.enum(MORNING_BRIEF_TOPIC_KEYS),
  headline: z.string().min(1),
  summary: z.string().min(1),
  source: z.string().min(1),
  url: z.string().optional()
});

const curatedBriefSchema = z.object({
  brief_date: z.string().min(1),
  weather_line: z.string().min(1),
  traffic_line: z.string().min(1),
  stories: z.array(curatedStorySchema).max(12)
});

const curatedBriefJsonSchema = {
  type: "object",
  properties: {
    brief_date: { type: "string" },
    weather_line: { type: "string" },
    traffic_line: { type: "string" },
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: [...MORNING_BRIEF_TOPIC_KEYS] },
          headline: { type: "string" },
          summary: { type: "string" },
          source: { type: "string" },
          url: { type: "string" }
        },
        required: ["topic", "headline", "summary", "source"]
      }
    }
  },
  required: ["brief_date", "weather_line", "traffic_line", "stories"]
} as const;

async function callGeminiJson(prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: sanitizeGeminiResponseSchema(curatedBriefJsonSchema)
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini curation failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini curation returned an empty response.");
  }

  return text;
}

export async function curateMorningBrief(input: {
  briefDate: string;
  scrape: MorningBriefScrapeResult;
}): Promise<CuratedMorningBrief> {
  const deterministicWeatherLine = input.scrape.weather?.island_line ?? MAURITIUS_WEATHER_FALLBACK_LINE;
  const weatherContext = input.scrape.weather
    ? {
        island_line: input.scrape.weather.island_line,
        zones: input.scrape.weather.zones.map((zone) => ({
          id: zone.id,
          label: zone.label,
          now: `${zone.current.temperature_c}°C, ${zone.current.condition}`,
          today: `${zone.today.temp_min_c}-${zone.today.temp_max_c}°C, rain chance ${zone.today.precip_probability_max}%`
        }))
      }
    : null;

  const articleSample = input.scrape.articles
    .slice(0, 25)
    .map(
      (article, index) =>
        `${index + 1}. [${article.source}] ${article.title}\n${article.summary}\n${article.url}`
    )
    .join("\n\n");

  const prompt = `You are Mauri, the Mauritian lifestyle engine.

Curate a clean morning brief for Mauritius using the raw inputs below.

Rules:
- Filter political noise, toxicity, and low-signal gossip.
- Keep summaries short, sharp, and useful for students and young professionals.
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- weather_line: use this exact sentence — "${deterministicWeatherLine}"
- traffic_line: one sentence about commute pressure using the traffic snapshot when available.
- stories: up to 8 high-signal stories tagged with one topic each from: Traffic, Tech, Money, LocalBuzz, Entertainment.
- Do not invent stories that are not grounded in the article list.
- brief_date must be ${input.briefDate}

Weather snapshot (Open-Meteo zones — do not rewrite weather_line):
${JSON.stringify(weatherContext, null, 2)}

Traffic snapshot:
${JSON.stringify(input.scrape.traffic, null, 2)}

Articles:
${articleSample || "No articles fetched. Return a brief with practical weather/traffic lines and 2 evergreen local-life reminders."}`;

  const raw = await callGeminiJson(prompt);
  const parsed = curatedBriefSchema.parse(parseStructuredJson(raw));

  return {
    brief_date: parsed.brief_date,
    weather_line: deterministicWeatherLine,
    traffic_line: parsed.traffic_line,
    stories: parsed.stories.map((story) => ({
      topic: story.topic as MorningBriefTopicKey,
      headline: story.headline,
      summary: story.summary,
      source: story.source,
      url: story.url
    }))
  };
}

export function buildPersonalizedMorningBriefMessage(input: {
  firstName: string | null;
  topics: MorningBriefTopicKey[];
  curated: CuratedMorningBrief;
  weatherLine?: string | undefined;
}): string {
  const name = input.firstName?.trim() || "there";
  const topicSet = new Set(input.topics);
  const stories = input.curated.stories
    .filter((story) => topicSet.has(story.topic as MorningBriefTopicKey))
    .slice(0, 3);
  const weatherLine = input.weatherLine?.trim() || input.curated.weather_line;
  const trafficLine = input.curated.traffic_line.trim();

  const lines = [`Morning ${name} — your 7am pulse`, ""];

  if (!/unavailable/i.test(weatherLine)) {
    lines.push(`☁️ ${weatherLine}`);
  }

  if (trafficLine && !/unavailable/i.test(trafficLine)) {
    lines.push(`🚗 ${trafficLine}`);
  }

  if (stories.length > 0) {
    lines.push("");
    for (const story of stories) {
      const headline = story.headline.length > 72 ? `${story.headline.slice(0, 69).trim()}…` : story.headline;
      lines.push(`#${story.topic} · ${headline}`);
    }
  } else {
    lines.push("", "Quiet news day for your tags — weather and traffic are the main signal.");
  }

  lines.push("", "Reply lesson for today's insight · my pace · digest off");
  return lines.join("\n");
}
