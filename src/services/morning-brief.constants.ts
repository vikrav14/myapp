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

export const MAURITIUS_WEATHER_ZONES = [
  {
    id: "west",
    label: "West / Port Louis",
    latitude: -20.1609,
    longitude: 57.5012,
    aliases: [
      "port louis",
      "port-louis",
      "tamarin",
      "flic en flac",
      "albion",
      "black river",
      "riviere noire",
      "cascavelle"
    ]
  },
  {
    id: "central",
    label: "Central Plateau",
    latitude: -20.298,
    longitude: 57.478,
    aliases: [
      "vacoas",
      "phoenix",
      "curepipe",
      "quatre bornes",
      "rose hill",
      "beau bassin",
      "moka",
      "ebene",
      "floreal",
      "midlands",
      "highlands"
    ]
  },
  {
    id: "north",
    label: "North / Grand Baie",
    latitude: -20.009,
    longitude: 57.58,
    aliases: [
      "grand baie",
      "grand bay",
      "pamplemousses",
      "triolet",
      "goodlands",
      "cap malheureux",
      "pereybere",
      "roche bois"
    ]
  },
  {
    id: "south",
    label: "South Coast",
    latitude: -20.408,
    longitude: 57.7,
    aliases: ["mahebourg", "souillac", "chemin grenier", "surinam", "bel air", "saint aubin", "plaine magnien"]
  },
  {
    id: "east",
    label: "East Coast",
    latitude: -20.198,
    longitude: 57.777,
    aliases: ["belle mare", "flacq", "poste de flacq", "centre de flacq", "palmar", "trou d'eau douce"]
  }
] as const;

export type MauritiusWeatherZoneDefinition = (typeof MAURITIUS_WEATHER_ZONES)[number];

/** @deprecated Use MAURITIUS_WEATHER_ZONES — kept for backward compatibility. */
export const MAURITIUS_WEATHER_COORDS = {
  latitude: MAURITIUS_WEATHER_ZONES[0].latitude,
  longitude: MAURITIUS_WEATHER_ZONES[0].longitude,
  label: MAURITIUS_WEATHER_ZONES[0].label
} as const;

export const ARCHETYPE_DEFAULT_TOPICS: Record<string, MorningBriefTopicKey[]> = {
  "Student Grind": ["Traffic", "Money", "LocalBuzz"],
  "Corporate / Career": ["Traffic", "Tech", "Money"],
  "Entrepreneur Mode": ["Tech", "Money", "LocalBuzz"],
  "Life & Habit Tracking": ["LocalBuzz", "Money", "Entertainment"],
  "Custom": ["Traffic", "Money", "LocalBuzz"]
};
