import type { MauriUser } from "../types.js";
import { isCustomLaneArchetype } from "../types.js";

export const BRIEF_FOCUS_PRESET_LABELS = {
  work: "Work & money",
  life: "Life & balance",
  hustle: "Hustle & projects",
  mix: "Mix of everything"
} as const;

const PRESET_ALIASES: Record<string, string> = {
  [BRIEF_FOCUS_PRESET_LABELS.work.toLowerCase()]: BRIEF_FOCUS_PRESET_LABELS.work,
  [BRIEF_FOCUS_PRESET_LABELS.life.toLowerCase()]: BRIEF_FOCUS_PRESET_LABELS.life,
  [BRIEF_FOCUS_PRESET_LABELS.hustle.toLowerCase()]: BRIEF_FOCUS_PRESET_LABELS.hustle,
  [BRIEF_FOCUS_PRESET_LABELS.mix.toLowerCase()]: BRIEF_FOCUS_PRESET_LABELS.mix,
  "work and money": BRIEF_FOCUS_PRESET_LABELS.work,
  "life and balance": BRIEF_FOCUS_PRESET_LABELS.life,
  "hustle and projects": BRIEF_FOCUS_PRESET_LABELS.hustle,
  "mix of everything": BRIEF_FOCUS_PRESET_LABELS.mix
};

const MIN_BRIEF_FOCUS_LENGTH = 3;
const MAX_BRIEF_FOCUS_LENGTH = 120;

export function buildBriefFocusPrompt(firstName?: string | null): string {
  const name = firstName?.trim() || "there";

  return `${name} — in a few words, what should your 7am brief focus on?

e.g. work + side app · family & balance

Tap a quick pick below, or type your own.`;
}

export function parseBriefFocusSelection(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < MIN_BRIEF_FOCUS_LENGTH) {
    return null;
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  const preset = PRESET_ALIASES[normalized];
  if (preset) {
    return preset;
  }

  const value = trimmed.length > MAX_BRIEF_FOCUS_LENGTH ? trimmed.slice(0, MAX_BRIEF_FOCUS_LENGTH).trim() : trimmed;
  return value.length >= MIN_BRIEF_FOCUS_LENGTH ? value : null;
}

export function displayPrimaryLaneLabel(user: Pick<MauriUser, "archetype" | "brief_focus">): string {
  if (!isCustomLaneArchetype(user.archetype)) {
    return user.archetype;
  }

  const focus = user.brief_focus?.trim();
  return focus ? `Your own mix — ${focus}` : "Your own mix";
}
