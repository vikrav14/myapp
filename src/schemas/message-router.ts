import { z } from "zod";

import { mauriBrainDumpSchema, parseStructuredJson } from "./extraction.js";

export const messageRouterIntentSchema = z.enum([
  "chat_only",
  "structured_log",
  "profile_delta",
  "mixed",
  "command"
]);

export type MessageRouterIntent = z.infer<typeof messageRouterIntentSchema>;

export const profileDeltaCategorySchema = z.enum([
  "identity",
  "location",
  "life_context",
  "interests",
  "goals",
  "stressors",
  "relationships",
  "preferences",
  "boundaries",
  "user_stated"
]);

export const profileDeltaSchema = z.object({
  category: profileDeltaCategorySchema,
  fact_key: z.string().min(1).max(48),
  fact_value: z.string().min(1).max(500),
  supersedes_key: z.string().min(1).max(48).optional()
});

export type ProfileDelta = z.infer<typeof profileDeltaSchema>;

export const todoCompletionSchema = z.object({
  task_match: z.string().min(1).max(200)
});

export const messageRouterConfidenceSchema = z.enum(["high", "medium", "low"]);

export const messageRouterExtractionSchema = z.object({
  intent: messageRouterIntentSchema,
  structured: mauriBrainDumpSchema.optional(),
  profile_deltas: z.array(profileDeltaSchema).max(24).optional(),
  todo_completions: z.array(todoCompletionSchema).max(5).optional(),
  open_loop_hint: z.string().min(1).max(300).optional(),
  confidence: messageRouterConfidenceSchema.optional()
});

export type MessageRouterExtraction = z.infer<typeof messageRouterExtractionSchema>;

export const messageRouterExtractionJsonSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["chat_only", "structured_log", "profile_delta", "mixed", "command"]
    },
    structured: {
      type: "object",
      properties: {
        finance: {
          type: "object",
          properties: {
            amount: { type: "number" },
            category: { type: "string" },
            context_tags: { type: "array", items: { type: "string" } },
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
              due_date: { type: "string" },
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
    },
    profile_deltas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "identity",
              "location",
              "life_context",
              "interests",
              "goals",
              "stressors",
              "relationships",
              "preferences",
              "boundaries",
              "user_stated"
            ]
          },
          fact_key: { type: "string" },
          fact_value: { type: "string" },
          supersedes_key: { type: "string" }
        },
        required: ["category", "fact_key", "fact_value"]
      }
    },
    todo_completions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task_match: { type: "string" }
        },
        required: ["task_match"]
      }
    },
    open_loop_hint: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["intent"]
} as const;

export function parseMessageRouterExtraction(rawText: string): MessageRouterExtraction {
  return messageRouterExtractionSchema.parse(parseStructuredJson(rawText));
}
