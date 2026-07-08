import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriBrainDumpExtraction } from "../types.js";
import { buildEmotionEmbedding } from "./memory.service.js";

export function matchesTodoTask(taskDescription: string, taskMatch: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const description = normalize(taskDescription);
  const match = normalize(taskMatch);

  if (!description || !match) {
    return false;
  }

  if (description.includes(match) || match.includes(description)) {
    return true;
  }

  const tokens = match.split(" ").filter((token) => token.length > 2);
  if (tokens.length === 0) {
    return false;
  }

  const hits = tokens.filter((token) => description.includes(token));
  return hits.length >= Math.ceil(tokens.length * 0.6);
}

export async function completeMatchedTodos(input: {
  userId: string;
  taskMatches: string[];
  lookbackDays?: number | undefined;
}): Promise<number> {
  const matches = input.taskMatches.map((taskMatch) => taskMatch.trim()).filter(Boolean);
  if (matches.length === 0) {
    return 0;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (input.lookbackDays ?? 14));

  const { data, error } = await supabase
    .from("todo_logs")
    .select("id, task_description")
    .eq("user_id", input.userId)
    .eq("is_completed", false)
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load open todos for completion: ${error.message}`);
  }

  const openTodos = data ?? [];
  const completedIds = new Set<string>();
  const completedAt = new Date().toISOString();

  for (const taskMatch of matches) {
    const todo = openTodos.find(
      (row) => !completedIds.has(String(row.id)) && matchesTodoTask(String(row.task_description), taskMatch)
    );

    if (!todo) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("todo_logs")
      .update({
        is_completed: true,
        completed_at: completedAt
      })
      .eq("id", todo.id)
      .eq("user_id", input.userId)
      .eq("is_completed", false);

    if (updateError) {
      logger.warn(
        { error: updateError, userId: input.userId, todoId: todo.id, taskMatch },
        "Failed to complete matched todo."
      );
      continue;
    }

    completedIds.add(String(todo.id));
  }

  return completedIds.size;
}

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
