import type {
  CuratedMorningBrief,
  CuratedMorningStory,
  MauriArchetype,
  MauriUser,
  MorningBriefDensity,
  MorningBriefTopicKey,
  UserMindFact
} from "../types.js";
import { MORNING_BRIEF_DENSITY_MAX_WORDS } from "./morning-brief-density.constants.js";
import { buildMorningPulseLabel } from "./express-onboarding.service.js";
import {
  buildPersonalizedWeatherLine,
  parseMauritiusWeatherSummary,
  resolveZoneIdFromArea,
  type MauritiusWeatherZoneId
} from "./mauritius-weather.service.js";
import {
  buildCommuteCorridorLabel,
  extractWorkPlace,
  fetchTrafficCorridor,
  isTrafficCorridorLive,
  parseTrafficSnapshot,
  type TrafficCorridorSnapshot,
  type TrafficSnapshot
} from "./mauritius-traffic.service.js";
import { isRemoteWorkerProfile } from "./profile-inference.service.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_CATALOG } from "./help-focus.constants.js";

export type { TrafficCorridorSnapshot, TrafficSnapshot } from "./mauritius-traffic.service.js";

export interface PulseStoryForUser {
  story: CuratedMorningStory;
  relevanceLine: string;
}

export interface UserPulseContext {
  weatherLine: string;
  trafficLine: string | null;
  stories: PulseStoryForUser[];
  activePinLine: string | null;
  pulseLabel: string;
  density: MorningBriefDensity;
}

const CORRIDOR_ZONE_HINTS: Record<
  string,
  { originZones: MauritiusWeatherZoneId[]; destinationZones: MauritiusWeatherZoneId[] }
> = {
  "Port Louis to Ebene": { originZones: ["west"], destinationZones: ["central"] },
  "Rose Hill to Port Louis": { originZones: ["central"], destinationZones: ["west"] },
  "Reduit to Port Louis": { originZones: ["north", "central"], destinationZones: ["west"] }
};

const TRAFFIC_UNAVAILABLE_PATTERN = /(unavailable|not available)/i;

function factBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
}

function combinedFactBlob(facts: UserMindFact[]): string {
  return facts.map(factBlob).join(" ");
}

export function resolveUserArea(facts: UserMindFact[]): string | null {
  const areaFact = facts.find((fact) => fact.category === "location" && fact.fact_key === "area");
  return areaFact?.fact_value?.trim() || null;
}

export function resolveWorkLocation(facts: UserMindFact[]): string | null {
  const workFact = facts.find((fact) => fact.category === "life_context" && fact.fact_key === "work");
  if (workFact?.fact_value?.trim()) {
    return workFact.fact_value.trim();
  }

  const workMatch = facts.find((fact) =>
    /\b(work in|office in|job in|commute to|based in ebene|cybercity|ébène|ebene)\b/i.test(factBlob(fact))
  );
  return workMatch?.fact_value?.trim() || null;
}

function scoreCorridorForUser(
  corridor: TrafficCorridorSnapshot,
  homeZone: MauritiusWeatherZoneId | null,
  workZone: MauritiusWeatherZoneId | null
): number {
  const hints = CORRIDOR_ZONE_HINTS[corridor.label];
  if (!hints) {
    return 0;
  }

  let score = 0;
  if (homeZone && hints.originZones.includes(homeZone)) {
    score += 3;
  }
  if (workZone && hints.destinationZones.includes(workZone)) {
    score += 3;
  }
  if (corridor.status === "OK" && corridor.duration_text !== "unknown") {
    score += 1;
  }

  return score;
}

export function pickCommuteCorridor(
  snapshot: TrafficSnapshot | null,
  facts: UserMindFact[]
): TrafficCorridorSnapshot | null {
  if (!snapshot?.configured || snapshot.corridors.length === 0) {
    return null;
  }

  const area = resolveUserArea(facts);
  const work = resolveWorkLocation(facts);
  const homeZone = resolveZoneIdFromArea(area);
  const workZone = resolveZoneIdFromArea(work);

  const ranked = [...snapshot.corridors].sort((left, right) => {
    const scoreDelta =
      scoreCorridorForUser(right, homeZone, workZone) - scoreCorridorForUser(left, homeZone, workZone);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (right.duration_seconds ?? 0) - (left.duration_seconds ?? 0);
  });

  return ranked[0] ?? null;
}

function formatTrafficLineFromCorridor(
  corridor: TrafficCorridorSnapshot,
  facts: UserMindFact[],
  customRoute = false
): string {
  const area = resolveUserArea(facts);
  const work = resolveWorkLocation(facts);
  const workPlace = work ? extractWorkPlace(work) : null;
  const routeHint =
    area && workPlace ? `${area} → ${workPlace}` : area ? `from ${area}` : corridor.label;

  if (customRoute) {
    return `Your commute (${routeHint}): ${corridor.duration_text}.`;
  }

  return `${corridor.label}: ${corridor.duration_text} (${routeHint}).`;
}

export async function fetchCustomCommuteCorridor(facts: UserMindFact[]): Promise<TrafficCorridorSnapshot | null> {
  const home = resolveUserArea(facts);
  const work = resolveWorkLocation(facts);
  if (!home || !work) {
    return null;
  }

  const workPlace = extractWorkPlace(work);
  if (!workPlace || workPlace.toLowerCase() === home.toLowerCase()) {
    return null;
  }

  return fetchTrafficCorridor({
    origin: home,
    destination: workPlace,
    label: buildCommuteCorridorLabel(home, workPlace)
  });
}

export async function buildPersonalizedTrafficLine(input: {
  curatedTrafficLine: string;
  trafficSnapshot: Record<string, unknown> | null | undefined;
  facts: UserMindFact[];
  fetchCustomCommute?: boolean | undefined;
}): Promise<string | null> {
  if (isRemoteWorkerProfile(input.facts)) {
    return "Remote day — corridor lines matter less; your weather line is the commute.";
  }

  if (input.fetchCustomCommute !== false) {
    const customCorridor = await fetchCustomCommuteCorridor(input.facts);
    if (isTrafficCorridorLive(customCorridor)) {
      return formatTrafficLineFromCorridor(customCorridor!, input.facts, true);
    }
  }

  const snapshot = parseTrafficSnapshot(input.trafficSnapshot);
  const corridor = pickCommuteCorridor(snapshot, input.facts);

  if (isTrafficCorridorLive(corridor)) {
    return formatTrafficLineFromCorridor(corridor!, input.facts);
  }

  const fallback = input.curatedTrafficLine.trim();
  if (fallback && !TRAFFIC_UNAVAILABLE_PATTERN.test(fallback)) {
    return fallback;
  }

  const hasCommute = /\b(commute|traffic|drive|hours in|road)\b/i.test(combinedFactBlob(input.facts));
  if (hasCommute) {
    return "Live corridor data wasn't ready — leave 15 min early if you're crossing the island.";
  }

  return null;
}

function helpFocusLabel(key: HelpFocusKey | null | undefined): string | null {
  if (!key) {
    return null;
  }

  return HELP_FOCUS_CATALOG.find((entry) => entry.key === key)?.label ?? null;
}

function topicBoostFromHelpFocus(topic: MorningBriefTopicKey, helpFocus: HelpFocusKey | null): number {
  if (!helpFocus) {
    return 0;
  }

  if (helpFocus === "personal_finance" && topic === "Money") {
    return 4;
  }
  if ((helpFocus === "career" || helpFocus === "productivity") && topic === "Tech") {
    return 3;
  }
  if (helpFocus === "business" && (topic === "Money" || topic === "Tech")) {
    return 3;
  }
  if (helpFocus === "health" && topic === "LocalBuzz") {
    return 2;
  }

  return 0;
}

function scoreStoryForUser(
  story: CuratedMorningStory,
  input: {
    topics: MorningBriefTopicKey[];
    archetype: MauriArchetype | null;
    briefFocus: string | null;
    helpFocus: HelpFocusKey | null;
    facts: UserMindFact[];
  }
): number {
  const topic = story.topic as MorningBriefTopicKey;
  if (!input.topics.includes(topic)) {
    return -100;
  }

  let score = 10;
  const topicIndex = input.topics.indexOf(topic);
  score += Math.max(0, 3 - topicIndex);

  const blob = combinedFactBlob(input.facts);
  const briefFocus = input.briefFocus?.toLowerCase() ?? "";

  if (briefFocus.includes(topic.toLowerCase()) || briefFocus.includes(topic.replace(/([A-Z])/g, " $1").trim().toLowerCase())) {
    score += 3;
  }

  score += topicBoostFromHelpFocus(topic, input.helpFocus);

  if (topic === "Money" && /\b(rent|loan|payday|salary|debt|runway|save|mcb)\b/i.test(blob)) {
    score += 3;
  }

  if (topic === "Traffic" && /\b(commute|traffic|drive|hours in|road)\b/i.test(blob)) {
    score += 4;
  }

  if (topic === "Tech" && /\b(dev|developer|tech|office|remote|work)\b/i.test(blob)) {
    score += 2;
  }

  if (topic === "LocalBuzz") {
    const area = resolveUserArea(input.facts);
    if (area && `${story.headline} ${story.summary}`.toLowerCase().includes(area.split(/\s+/)[0]!.toLowerCase())) {
      score += 2;
    }
  }

  if (isRemoteWorkerProfile(input.facts) && topic === "Traffic") {
    score -= 5;
  }

  if (input.archetype === "Corporate / Career" && (topic === "Tech" || topic === "Money")) {
    score += 1;
  }

  return score;
}

export function rankStoriesForUser(input: {
  curated: CuratedMorningBrief;
  topics: MorningBriefTopicKey[];
  user: MauriUser;
  facts: UserMindFact[];
  maxStories?: number | undefined;
}): CuratedMorningStory[] {
  const maxStories = input.maxStories ?? 3;

  return [...input.curated.stories]
    .map((story, index) => ({
      story,
      score: scoreStoryForUser(story, {
        topics: input.topics,
        archetype: (input.user.archetype as MauriArchetype | null) ?? null,
        briefFocus: input.user.brief_focus,
        helpFocus: input.user.help_focus_primary,
        facts: input.facts
      }),
      index
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxStories)
    .map((entry) => entry.story);
}

export function buildStoryRelevanceLine(input: {
  story: CuratedMorningStory;
  user: MauriUser;
  facts: UserMindFact[];
}): string {
  const topic = input.story.topic as MorningBriefTopicKey;
  const blob = combinedFactBlob(input.facts);
  const area = resolveUserArea(input.facts);
  const helpLabel = helpFocusLabel(input.user.help_focus_primary);

  if (topic === "Money") {
    if (/\b(rent|loan|payday|runway|debt)\b/i.test(blob)) {
      return helpLabel ? `Your ${helpLabel.toLowerCase()} lens — rent and runway.` : "Your money track — rent and runway.";
    }
    return helpLabel ? `Fits your ${helpLabel.toLowerCase()} lane this morning.` : "Worth a scan for salary and cost-of-life.";
  }

  if (topic === "Traffic") {
    const commute = input.facts.find((fact) => /\b(commute|traffic|hours in)\b/i.test(factBlob(fact)));
    if (commute) {
      return "Your corridor — plan the buffer before you roll.";
    }
    return "Island commute signal — useful if you're moving today.";
  }

  if (topic === "Tech") {
    if (input.user.archetype === "Corporate / Career" || /\b(dev|tech|office|remote)\b/i.test(blob)) {
      return helpLabel ? `Work-tech angle — ${helpLabel.toLowerCase()} crowd.` : "Work-tech angle before your day kicks off.";
    }
    return "Tech pulse — side hustle or day job.";
  }

  if (topic === "LocalBuzz") {
    return area ? `Local to ${area} this morning.` : "Island buzz — what's moving around you.";
  }

  if (topic === "Entertainment") {
    return "Light signal — unwind if you need it later.";
  }

  return "On your tags — quick scan, no rabbit hole.";
}

export function buildActivePinLine(openLoops: string[]): string | null {
  const loop = openLoops.map((entry) => entry.trim()).find(Boolean);
  if (!loop) {
    return null;
  }

  const sanitized = loop.replace(/\s+/g, " ").trim();
  const short = sanitized.length > 55 ? `${sanitized.slice(0, 52)}...` : sanitized;
  return `📌 Still on your radar: ${short}`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function trimPulseStoriesToWordLimit(
  stories: PulseStoryForUser[],
  maxWords: number,
  overheadWords: number,
  density: MorningBriefDensity
): PulseStoryForUser[] {
  if (density === "full") {
    return stories;
  }

  let trimmed = [...stories];

  while (trimmed.length > 0) {
    const storyWords = trimmed.reduce(
      (total, entry) =>
        total +
        countWords(entry.story.headline) +
        countWords(entry.relevanceLine) +
        6,
      0
    );

    if (overheadWords + storyWords <= maxWords) {
      return trimmed;
    }

    if (trimmed.length > 2) {
      trimmed = trimmed.slice(0, 2);
      continue;
    }

    trimmed = trimmed.map((entry, index) =>
      index === trimmed.length - 1
        ? { ...entry, relevanceLine: entry.relevanceLine.split(" ").slice(0, 6).join(" ") + "." }
        : entry
    );

    if (trimmed.length === 1) {
      break;
    }

    trimmed = trimmed.slice(0, 1);
  }

  return trimmed;
}

export async function buildUserPulseContext(input: {
  user: MauriUser;
  curated: CuratedMorningBrief;
  weatherSnapshot: Record<string, unknown> | null | undefined;
  trafficSnapshot: Record<string, unknown> | null | undefined;
  facts: UserMindFact[];
  openLoops: string[];
  fetchCustomCommute?: boolean | undefined;
}): Promise<UserPulseContext> {
  const density = input.user.morning_brief_density ?? "pulse";
  const weatherSummary = parseMauritiusWeatherSummary(input.weatherSnapshot ?? null);
  const userArea = resolveUserArea(input.facts);
  const weatherLine = buildPersonalizedWeatherLine(weatherSummary, userArea);
  const trafficLine = await buildPersonalizedTrafficLine({
    curatedTrafficLine: input.curated.traffic_line,
    trafficSnapshot: input.trafficSnapshot,
    facts: input.facts,
    fetchCustomCommute: input.fetchCustomCommute
  });

  const rankedStories = rankStoriesForUser({
    curated: input.curated,
    topics: input.user.topic_preferences as MorningBriefTopicKey[],
    user: input.user,
    facts: input.facts,
    maxStories: density === "full" ? 3 : 3
  });

  const stories = rankedStories.map((story) => ({
    story,
    relevanceLine: buildStoryRelevanceLine({ story, user: input.user, facts: input.facts })
  }));

  const pulseLabel = buildMorningPulseLabel(
    (input.user.archetype as MauriArchetype | null) ?? "Life & Habit Tracking",
    input.facts
  );
  const activePinLine = buildActivePinLine(input.openLoops);
  const maxWords = MORNING_BRIEF_DENSITY_MAX_WORDS[density];

  const overhead =
    countWords(`Morning there — your 7am pulse (${pulseLabel})`) +
    countWords(weatherLine) +
    countWords(trafficLine ?? "") +
    countWords(activePinLine ?? "") +
    12;

  const trimmedStories = trimPulseStoriesToWordLimit(stories, maxWords, overhead, density);

  return {
    weatherLine,
    trafficLine,
    stories: trimmedStories,
    activePinLine,
    pulseLabel,
    density
  };
}
