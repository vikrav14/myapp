export const MORNING_BRIEF_TOPIC_KEYS = [
  "Traffic",
  "Tech",
  "Money",
  "LocalBuzz",
  "Entertainment"
] as const;

export type MorningBriefTopicKey = (typeof MORNING_BRIEF_TOPIC_KEYS)[number];

export const MORNING_BRIEF_TOPIC_CATALOG: Array<{
  key: MorningBriefTopicKey;
  label: string;
  aliases: string[];
}> = [
  { key: "Traffic", label: "Traffic", aliases: ["traffic", "#traffic", "1"] },
  { key: "Tech", label: "Tech", aliases: ["tech", "#tech", "technology", "2"] },
  { key: "Money", label: "Money", aliases: ["money", "#money", "finance", "budget", "3"] },
  { key: "LocalBuzz", label: "Local Buzz", aliases: ["localbuzz", "local buzz", "#localbuzz", "news", "4"] },
  { key: "Entertainment", label: "Entertainment", aliases: ["entertainment", "#entertainment", "culture", "5"] }
];

export const DEFAULT_MORNING_BRIEF_RSS_FEEDS = [
  "https://defimedia.info/rss.xml",
  "https://www.lexpress.mu/rss",
  "https://www.lemauricien.com/feed/"
];

export const MAURITIUS_TRAFFIC_CORRIDORS = [
  {
    label: "Port Louis to Ebene",
    origin: "Port Louis, Mauritius",
    destination: "Ebene, Mauritius"
  },
  {
    label: "Rose Hill to Port Louis",
    origin: "Rose Hill, Mauritius",
    destination: "Port Louis, Mauritius"
  },
  {
    label: "Reduit to Port Louis",
    origin: "Reduit, Mauritius",
    destination: "Port Louis, Mauritius"
  }
] as const;

export const MAURITIUS_WEATHER_COORDS = {
  latitude: -20.1609,
  longitude: 57.5012,
  label: "Port Louis"
} as const;

export const ARCHETYPE_DEFAULT_TOPICS: Record<string, MorningBriefTopicKey[]> = {
  "Student Grind": ["Traffic", "Money", "LocalBuzz"],
  "Corporate / Career": ["Traffic", "Tech", "Money"],
  "Entrepreneur Mode": ["Tech", "Money", "LocalBuzz"],
  "Life & Habit Tracking": ["LocalBuzz", "Money", "Entertainment"],
  "Custom": ["Traffic", "Money", "LocalBuzz"]
};
