import type { CuratedMorningBrief, MauriArchetype, MorningBriefTopicKey } from "../types.js";
import { buildPersonalizedMorningBriefMessage } from "./morning-brief-curation.service.js";
import { todayBriefDate, getDailyBriefRunByDate, parseCuratedMorningBrief } from "./morning-brief-run.service.js";

const PREVIEW_STORY_SAMPLES: Record<MorningBriefTopicKey, { headline: string; summary: string }> = {
  Traffic: {
    headline: "Port Louis commute check",
    summary: "Morning corridors can tighten around 7:30 — leave a few minutes early if you're heading in."
  },
  Tech: {
    headline: "Local tech and work pulse",
    summary: "Ebene and remote-work updates that matter for young professionals on the island."
  },
  Money: {
    headline: "Budget reality check",
    summary: "Quick reads on prices, salaries, and everyday spending pressure in Mauritius."
  },
  LocalBuzz: {
    headline: "What's moving in Mauritius",
    summary: "Campus, policy, and local headlines pulled from Mauritian news each morning."
  },
  Entertainment: {
    headline: "Culture and weekend signal",
    summary: "Events, music, and island life picks when you want a lighter start."
  }
};

function buildFallbackCuratedBrief(topics: MorningBriefTopicKey[]): CuratedMorningBrief {
  const topicSet = new Set(topics);

  return {
    brief_date: todayBriefDate(),
    weather_line: "Warm morning across Mauritius — coastal breeze, inland heat building by midday.",
    traffic_line: "Port Louis and Ebene corridors usually tighten around peak commute — plan a few extra minutes.",
    stories: (Object.keys(PREVIEW_STORY_SAMPLES) as MorningBriefTopicKey[])
      .filter((topic) => topicSet.has(topic))
      .map((topic) => ({
        topic,
        headline: PREVIEW_STORY_SAMPLES[topic].headline,
        summary: PREVIEW_STORY_SAMPLES[topic].summary,
        source: "Mauri preview"
      }))
  };
}

export async function buildOnboardingPreviewBrief(input: {
  firstName: string | null;
  archetype: MauriArchetype | string;
  topics: MorningBriefTopicKey[];
}): Promise<string> {
  const briefDate = todayBriefDate();
  const run = await getDailyBriefRunByDate(briefDate);
  const curated = run?.curated_payload ? parseCuratedMorningBrief(run.curated_payload) : null;
  const hasLiveBrief =
    curated &&
    curated.weather_line.trim().length > 0 &&
    curated.traffic_line.trim().length > 0 &&
    curated.stories.length > 0;

  const previewCurated = hasLiveBrief ? curated : buildFallbackCuratedBrief(input.topics);
  const body = buildPersonalizedMorningBriefMessage({
    firstName: input.firstName,
    topics: input.topics,
    curated: previewCurated
  });

  const opener = hasLiveBrief
    ? "Here's a live preview of your 7:00 vibe check."
    : `Here's a preview of your 7:00 vibe check for ${input.archetype}.`;

  return `${opener}\n\n${body}`;
}
