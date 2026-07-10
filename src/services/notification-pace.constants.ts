export type ProactivePacePreset = "silent" | "bookends" | "steady" | "engaged" | "coaching";

export type DensityProfile = "micro" | "pulse" | "depth";

export interface NotificationConfig {
  proactive_preset: ProactivePacePreset;
  density_profile: DensityProfile;
  proactive_max_per_day: number;
  proactive_min_interval_minutes: number;
  proactive_max_per_week: number;
  configured_at?: string | undefined;
}

export interface PacePresetDefinition {
  key: ProactivePacePreset;
  label: string;
  description: string;
  density_profile: DensityProfile;
  proactive_max_per_day: number;
  proactive_min_interval_minutes: number;
  proactive_max_per_week: number;
}

export const PACE_PRESET_CATALOG: PacePresetDefinition[] = [
  {
    key: "bookends",
    label: "Twice a day",
    description: "Morning + evening mate check-ins",
    density_profile: "depth",
    proactive_max_per_day: 2,
    proactive_min_interval_minutes: 360,
    proactive_max_per_week: 14
  },
  {
    key: "steady",
    label: "Every few hours",
    description: "Steady unprompted pings in active hours",
    density_profile: "pulse",
    proactive_max_per_day: 4,
    proactive_min_interval_minutes: 180,
    proactive_max_per_week: 21
  },
  {
    key: "engaged",
    label: "Keep me on it",
    description: "More frequent nudges when you're grinding",
    density_profile: "pulse",
    proactive_max_per_day: 6,
    proactive_min_interval_minutes: 90,
    proactive_max_per_week: 28
  },
  {
    key: "coaching",
    label: "Coaching mode",
    description: "High-intensity — max contact, short pings",
    density_profile: "micro",
    proactive_max_per_day: 8,
    proactive_min_interval_minutes: 30,
    proactive_max_per_week: 42
  },
  {
    key: "silent",
    label: "Only when I message",
    description: "No unprompted mate pings — you drive",
    density_profile: "pulse",
    proactive_max_per_day: 0,
    proactive_min_interval_minutes: 0,
    proactive_max_per_week: 0
  }
];

export const DEFAULT_PROACTIVE_PACE_PRESET: ProactivePacePreset = "bookends";

export const DENSITY_MAX_WORDS: Record<DensityProfile, number> = {
  micro: 30,
  pulse: 50,
  depth: 90
};
