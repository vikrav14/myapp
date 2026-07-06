import type { MauriArchetype } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE } from "../types.js";

export const MAURI_MODULE_KEYS = ["career", "habits", "founder", "student"] as const;

export type MauriModuleKey = (typeof MAURI_MODULE_KEYS)[number];

export const MAX_ACTIVE_MODULES = 3;

export const MODULE_CATALOG: Record<
  MauriModuleKey,
  { label: string; shortLabel: string; description: string; command: string }
> = {
  career: {
    label: "Career tools",
    shortLabel: "Career",
    description: "Payday runway, work blocks, todo nudges",
    command: "career"
  },
  habits: {
    label: "Habits & balance",
    shortLabel: "Habits",
    description: "Mood, routines, gentle check-ins",
    command: "habits"
  },
  founder: {
    label: "Founder tools",
    shortLabel: "Founder",
    description: "Side hustle cashflow, focus blocks",
    command: "founder"
  },
  student: {
    label: "Student tools",
    shortLabel: "Student",
    description: "Study blocks, exam awareness",
    command: "student"
  }
};

export const PRIMARY_DEFAULT_MODULE: Partial<Record<MauriArchetype | string, MauriModuleKey>> = {
  "Corporate / Career": "career",
  "Life & Habit Tracking": "habits",
  "Student Grind": "student",
  "Entrepreneur Mode": "founder"
};

export const PRIMARY_LANE_TO_SUGGESTED_EXTRA: Partial<Record<MauriArchetype | string, MauriModuleKey>> = {
  "Corporate / Career": "habits",
  "Entrepreneur Mode": "career",
  [CUSTOM_LANE_ARCHETYPE]: "habits"
};
