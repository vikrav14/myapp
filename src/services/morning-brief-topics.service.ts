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
