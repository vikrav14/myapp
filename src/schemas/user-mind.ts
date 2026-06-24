import { z } from "zod";

import { parseStructuredJson } from "./extraction.js";

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
