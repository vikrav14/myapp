import type { MauriArchetype } from "../types.js";
import {
  ARCHETYPE_DEFAULT_TOPICS,
  MORNING_BRIEF_TOPIC_CATALOG,
  MORNING_BRIEF_TOPIC_KEYS,
  type MorningBriefTopicKey
} from "./morning-brief.constants.js";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^#/, "");
}

export function parseTopicSelection(message: string): MorningBriefTopicKey[] {
  const tokens = message
    .split(/[\s,;|/]+/)
    .map((token) => normalize(token))
    .filter(Boolean);

  const selected = new Set<MorningBriefTopicKey>();

  for (const token of tokens) {
    for (const entry of MORNING_BRIEF_TOPIC_CATALOG) {
      if (entry.aliases.some((alias) => normalize(alias) === token || token === normalize(entry.key))) {
        selected.add(entry.key);
      }
    }
  }

  return MORNING_BRIEF_TOPIC_KEYS.filter((key) => selected.has(key));
}

export function defaultTopicsForArchetype(archetype: string): MorningBriefTopicKey[] {
  return ARCHETYPE_DEFAULT_TOPICS[archetype] ?? ["Traffic", "LocalBuzz", "Money"];
}

const TOPIC_CONFIRMATION_PHRASES = new Set([
  "ok",
  "okay",
  "yes",
  "yep",
  "yup",
  "confirm",
  "confirmed",
  "sounds good",
  "looks good",
  "perfect",
  "👍",
  "✅"
]);

export function isTopicConfirmation(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return TOPIC_CONFIRMATION_PHRASES.has(normalized);
}

export function buildSuggestedTopicsPrompt(archetype: MauriArchetype | string): string {
  const suggested = defaultTopicsForArchetype(archetype);

  return `Locked in: ${archetype}.

Your 7:00 brief will focus on: ${formatTopicList(suggested)}

Reply OK to confirm.
Or send 3 to 5 different tags: Traffic, Tech, Money, LocalBuzz, Entertainment.`;
}

export function buildTopicSelectionPrompt(): string {
  const lines = MORNING_BRIEF_TOPIC_CATALOG.map(
    (entry, index) => `${index + 1}. ${entry.label} (#${entry.key})`
  );

  return `Now pick 3 to 5 morning brief topics.

I'll send your Mauritian vibe check at 7:00 with weather, traffic, and stories matched to these tags.

${lines.join("\n")}

Reply with numbers, names, or hashtags. Example: 1, 3, 4 or Traffic Money LocalBuzz`;
}

export function formatTopicList(topics: MorningBriefTopicKey[]): string {
  return topics.map((topic) => `#${topic}`).join(" ");
}

export function isValidTopicSelection(topics: MorningBriefTopicKey[]): boolean {
  return topics.length >= 3 && topics.length <= 5;
}

export function parseTopicPreferenceCommand(
  message: string
): { type: "show" } | { type: "update"; selection: string } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "my topics" ||
    normalized === "topics" ||
    normalized === "morning topics" ||
    normalized === "topic status" ||
    normalized === "show topics"
  ) {
    return { type: "show" };
  }

  const updateMatch = normalized.match(/^(?:update topics|set topics|change topics)\s+(.+)$/);
  if (updateMatch?.[1]) {
    return { type: "update", selection: updateMatch[1] };
  }

  if (normalized === "update topics" || normalized === "set topics" || normalized === "change topics") {
    return { type: "update", selection: "" };
  }

  return null;
}

export function buildTopicUpdatePrompt(): string {
  const lines = MORNING_BRIEF_TOPIC_CATALOG.map(
    (entry, index) => `${index + 1}. ${entry.label} (#${entry.key})`
  );

  return `Send your new morning brief tags in one message.

Pick 3 to 5:
${lines.join("\n")}

Example: update topics Traffic Money Tech`;
}

export function buildTopicStatusReply(topics: MorningBriefTopicKey[], digestEnabled: boolean): string {
  if (!topics.length) {
    return `You don't have morning brief topics set yet.

Reply like this:
update topics Traffic Money LocalBuzz

I'll use those tags for your 7:00 vibe check.`;
  }

  return `Your morning brief tags: ${formatTopicList(topics)}

Digest: ${digestEnabled ? "on" : "off"}
I'll match stories to those tags at 7:00.

To change them:
update topics Traffic Money Tech`;
}
