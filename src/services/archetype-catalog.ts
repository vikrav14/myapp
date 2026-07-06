import type { MauriArchetype } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE } from "../types.js";

export interface ArchetypeCatalogEntry {
  number: number;
  archetype: MauriArchetype;
  interactiveId: string;
  title: string;
  shortTitle: string;
  description: string;
  aliases: string[];
}

/** Canonical 1–5 order used in copy, numeric replies, and the WhatsApp picker. */
export const ARCHETYPE_CATALOG: ArchetypeCatalogEntry[] = [
  {
    number: 1,
    archetype: "Corporate / Career",
    interactiveId: "archetype_corporate",
    title: "Corporate / Career",
    shortTitle: "Corporate / Career",
    description: "Work wins, salary, commute",
    aliases: ["corporate", "career", "job", "office", "work", "professional"]
  },
  {
    number: 2,
    archetype: "Life & Habit Tracking",
    interactiveId: "archetype_life",
    title: "Life & Habits",
    shortTitle: "Life & Habits",
    description: "Mood, routines, balance",
    aliases: ["habit", "habits", "life", "life & habits", "wellness", "balance", "routine", "tracking"]
  },
  {
    number: 3,
    archetype: "Student Grind",
    interactiveId: "archetype_student",
    title: "Student Grind",
    shortTitle: "Student Grind",
    description: "Exams, uni, student spending",
    aliases: ["student", "student grind", "uom", "utm", "uni", "university", "study", "exams"]
  },
  {
    number: 4,
    archetype: "Entrepreneur Mode",
    interactiveId: "archetype_entrepreneur",
    title: "Entrepreneur Mode",
    shortTitle: "Entrepreneur Mode",
    description: "Cashflow, hustle, focus blocks",
    aliases: ["entrepreneur", "business", "startup", "founder", "side hustle"]
  }
];

export const CUSTOM_LANE_NUMBER = 5;

const CUSTOM_LANE_ALIASES = [
  "custom",
  "my own mix",
  "custom lane",
  "something else",
  "none of these",
  "none fit",
  "own mix",
  "my lane",
  "my own lane"
];

export function isCustomLaneSelection(normalized: string): boolean {
  if (["5", "mix", "custom"].includes(normalized)) {
    return true;
  }

  return CUSTOM_LANE_ALIASES.some((alias) => normalized === alias);
}

export function buildArchetypeLaneList(): string {
  const presetLines = ARCHETYPE_CATALOG.map((entry) => `${entry.number}. ${entry.shortTitle}`).join("\n");

  return `${presetLines}
${CUSTOM_LANE_NUMBER}. Your own mix — define your brief focus, then your tags.

Tap Pick brief lane below, then tap your choice.`;
}

export function inferArchetypeFromMessage(message: string): MauriArchetype | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (isCustomLaneSelection(normalized)) {
    return CUSTOM_LANE_ARCHETYPE;
  }

  const numberOnly = normalized.match(/^(\d)$/);
  if (numberOnly) {
    const entry = ARCHETYPE_CATALOG.find((item) => item.number === Number(numberOnly[1]));
    return entry?.archetype ?? null;
  }

  for (const entry of ARCHETYPE_CATALOG) {
    if (normalized === entry.archetype.toLowerCase() || normalized === entry.shortTitle.toLowerCase()) {
      return entry.archetype;
    }

    if (
      entry.aliases.some((alias) => normalized === alias || normalized.includes(alias))
    ) {
      return entry.archetype;
    }
  }

  return null;
}

export function buildArchetypePickerRows(): Array<{
  id: string;
  title: string;
  description: string;
}> {
  return [
    ...ARCHETYPE_CATALOG.map((entry) => ({
      id: entry.interactiveId,
      title: entry.title,
      description: entry.description
    })),
    {
      id: "archetype_custom",
      title: "Your own mix",
      description: "Define what your 7am brief focuses on"
    }
  ];
}
