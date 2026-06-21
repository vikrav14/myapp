import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriBrainDumpExtraction } from "../types.js";
import { buildEmotionEmbedding } from "./memory.service.js";

export async function persistExtraction(userId: string, extraction: MauriBrainDumpExtraction): Promise<void> {
  const writes: Array<Promise<unknown>> = [];

  if (extraction.finance) {
    writes.push(
      Promise.resolve(
        supabase.from("finance_logs").insert({
          user_id: userId,
          amount: extraction.finance.amount,
          category: extraction.finance.category,
          context_tags: extraction.finance.context_tags ?? [],
          raw_source_text: extraction.finance.raw_source_text
        })
      )
    );
  }

  if (extraction.habits) {
    writes.push(
      Promise.resolve(
        supabase.from("habit_logs").insert({
          user_id: userId,
          activity_type: extraction.habits.activity_type,
          duration_minutes: extraction.habits.duration_minutes ?? 0,
          is_success: extraction.habits.is_success,
          context_note: extraction.habits.context_note ?? null
        })
      )
    );
  }

  if (extraction.todos?.length) {
    writes.push(
      Promise.resolve(
        supabase.from("todo_logs").insert(
          extraction.todos.map((todo) => ({
            user_id: userId,
            task_description: todo.task_description,
            due_date: todo.due_date ?? null,
            priority: todo.priority ?? "Medium"
          }))
        )
      )
    );
  }

  if (extraction.emotions) {
    let emotionEmbedding: string | null = null;

    try {
      emotionEmbedding = await buildEmotionEmbedding(extraction.emotions.raw_unfiltered_vent);
    } catch (error) {
      logger.warn({ error, userId }, "Failed to embed emotional insight. Continuing without vector.");
    }

    writes.push(
      Promise.resolve(
        supabase.from("insights_vault").insert({
          user_id: userId,
          anxiety_score: extraction.emotions.anxiety_score,
          core_emotional_driver: extraction.emotions.core_emotional_driver ?? null,
          raw_unfiltered_vent: extraction.emotions.raw_unfiltered_vent,
          embedding: emotionEmbedding
        })
      )
    );
  }

  const results = await Promise.all(writes);

  const failed = results.find((result) => {
    if (typeof result !== "object" || result === null || !("error" in result)) {
      return false;
    }

    return Boolean(result.error);
  }) as { error?: { message?: string } } | undefined;

  if (failed?.error) {
    throw new Error(`Failed to persist extraction: ${failed.error.message ?? "Unknown Supabase error"}`);
  }
}
