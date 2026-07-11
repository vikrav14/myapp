import type { MorningBriefDensity } from "../types.js";

export const MORNING_BRIEF_DENSITY_KEYS = ["pulse", "full"] as const;

export type { MorningBriefDensity };

export const MORNING_BRIEF_DENSITY_MAX_WORDS: Record<MorningBriefDensity, number> = {
  pulse: 100,
  full: 200
};

export const MORNING_BRIEF_DENSITY_LABELS: Record<MorningBriefDensity, string> = {
  pulse: "Pulse — tight scan (~100 words)",
  full: "Full — more context (~200 words)"
};

export function sanitizeMorningBriefDensity(value: unknown): MorningBriefDensity {
  return value === "full" ? "full" : "pulse";
}
