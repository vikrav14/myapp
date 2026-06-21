import { z } from "zod";

export const mauriBrainDumpJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "MauriBrainDumpExtraction",
  type: "object",
  properties: {
    finance: {
      type: "object",
      properties: {
        amount: { type: "number" },
        category: { type: "string" },
        context_tags: {
          type: "array",
          items: { type: "string" }
        },
        raw_source_text: { type: "string" }
      },
      required: ["amount", "category", "raw_source_text"]
    },
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task_description: { type: "string" },
          due_date: { type: "string", format: "date-time" },
          priority: { type: "string", enum: ["High", "Medium", "Low"] }
        },
        required: ["task_description"]
      }
    },
    habits: {
      type: "object",
      properties: {
        activity_type: { type: "string" },
        duration_minutes: { type: "integer" },
        is_success: { type: "boolean" },
        context_note: { type: "string" }
      },
      required: ["activity_type", "is_success"]
    },
    emotions: {
      type: "object",
      properties: {
        anxiety_score: { type: "integer", minimum: 1, maximum: 5 },
        core_emotional_driver: { type: "string" },
        raw_unfiltered_vent: { type: "string" }
      },
      required: ["anxiety_score", "raw_unfiltered_vent"]
    }
  }
} as const;

export const mauriBrainDumpSchema = z.object({
  finance: z
    .object({
      amount: z.number(),
      category: z.string().min(1),
      context_tags: z.array(z.string()).optional(),
      raw_source_text: z.string().min(1)
    })
    .optional(),
  todos: z
    .array(
      z.object({
        task_description: z.string().min(1),
        due_date: z.iso.datetime().optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional()
      })
    )
    .optional(),
  habits: z
    .object({
      activity_type: z.string().min(1),
      duration_minutes: z.number().int().nonnegative().optional(),
      is_success: z.boolean(),
      context_note: z.string().optional()
    })
    .optional(),
  emotions: z
    .object({
      anxiety_score: z.number().int().min(1).max(5),
      core_emotional_driver: z.string().optional(),
      raw_unfiltered_vent: z.string().min(1)
    })
    .optional()
});

export function parseStructuredJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(withoutFence);
}
