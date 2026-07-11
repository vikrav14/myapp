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

/** Marketing order: grinding → pulse → bookends → silent → coaching */
export const PACE_PRESET_CATALOG: PacePresetDefinition[] = [
  {
    key: "engaged",
    label: "Keep me on it",
    description: "Nudges when you're grinding",
    density_profile: "pulse",
    proactive_max_per_day: 6,
    proactive_min_interval_minutes: 90,
    proactive_max_per_week: 28
  },
  {
    key: "steady",
    label: "The pulse",
    description: "Every few hours when you're quiet",
    density_profile: "pulse",
    proactive_max_per_day: 4,
    proactive_min_interval_minutes: 180,
    proactive_max_per_week: 21
  },
  {
    key: "bookends",
    label: "Bookends",
    description: "7am pulse + ~7pm pin on your line",
    density_profile: "depth",
    proactive_max_per_day: 2,
    proactive_min_interval_minutes: 360,
    proactive_max_per_week: 14
  },
  {
    key: "silent",
    label: "Pure utility",
    description: "Only when you text me",
    density_profile: "pulse",
    proactive_max_per_day: 0,
    proactive_min_interval_minutes: 0,
    proactive_max_per_week: 0
  },
  {
    key: "coaching",
    label: "Coaching mode",
    description: "High-intensity — max contact, short pings",
    density_profile: "micro",
    proactive_max_per_day: 8,
    proactive_min_interval_minutes: 30,
    proactive_max_per_week: 42
  }
];

export const DEFAULT_PROACTIVE_PACE_PRESET: ProactivePacePreset = "bookends";

export const DENSITY_MAX_WORDS: Record<DensityProfile, number> = {
  micro: 30,
  pulse: 50,
  depth: 90
};
