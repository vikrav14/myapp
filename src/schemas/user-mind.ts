import { z } from "zod";

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
