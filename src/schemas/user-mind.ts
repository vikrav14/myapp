import { z } from "zod";

import { parseStructuredJson } from "./extraction.js";

export const userMindExtractionJsonSchema = {
  type: "object",
  properties: {
    preferred_name: { type: "string" },
    age: { type: "integer" },
    age_band: { type: "string" },
    area: { type: "string" },
    work: { type: "string" },
    life_situation: { type: "string" },
    interests: {
      type: "array",
      items: { type: "string" }
    },
    goals: {
      type: "array",
      items: { type: "string" }
    },
    stressors: {
      type: "array",
      items: { type: "string" }
    },
    tone_preference: { type: "string" },
    boundaries: {
      type: "array",
      items: { type: "string" }
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          note: { type: "string" }
        },
        required: ["label"]
      }
    }
  }
} as const;

export const userMindExtractionSchema = z.object({
  preferred_name: z.string().min(1).optional(),
  age: z.number().int().positive().max(120).optional(),
  age_band: z.string().min(1).optional(),
  area: z.string().min(1).optional(),
  work: z.string().min(1).optional(),
  life_situation: z.string().min(1).optional(),
  interests: z.array(z.string().min(1)).optional(),
  goals: z.array(z.string().min(1)).optional(),
  stressors: z.array(z.string().min(1)).optional(),
  tone_preference: z.string().min(1).optional(),
  boundaries: z.array(z.string().min(1)).optional(),
  relationships: z
    .array(
      z.object({
        label: z.string().min(1),
        note: z.string().optional()
      })
    )
    .optional()
});

export type UserMindExtraction = z.infer<typeof userMindExtractionSchema>;

export const userMindSnapshotSchema = z.object({
  life_summary: z.string().min(1),
  personality_notes: z.string().min(1),
  money_pattern: z.string().min(1),
  habit_pattern: z.string().min(1),
  emotional_pattern: z.string().min(1),
  active_goals: z.array(z.string()).max(8),
  recent_wins: z.array(z.string()).max(6),
  open_loops: z.array(z.string()).max(8),
  advice_preferences: z.string().min(1),
  things_to_avoid: z.array(z.string()).max(6)
});

export type UserMindSnapshotPayload = z.infer<typeof userMindSnapshotSchema>;

export const userMindSnapshotJsonSchema = {
  type: "object",
  properties: {
    life_summary: { type: "string" },
    personality_notes: { type: "string" },
    money_pattern: { type: "string" },
    habit_pattern: { type: "string" },
    emotional_pattern: { type: "string" },
    active_goals: { type: "array", items: { type: "string" } },
    recent_wins: { type: "array", items: { type: "string" } },
    open_loops: { type: "array", items: { type: "string" } },
    advice_preferences: { type: "string" },
    things_to_avoid: { type: "array", items: { type: "string" } }
  },
  required: [
    "life_summary",
    "personality_notes",
    "money_pattern",
    "habit_pattern",
    "emotional_pattern",
    "active_goals",
    "recent_wins",
    "open_loops",
    "advice_preferences",
    "things_to_avoid"
  ]
} as const;

export function parseUserMindSnapshot(raw: string): UserMindSnapshotPayload {
  return userMindSnapshotSchema.parse(parseStructuredJson(raw));
}
