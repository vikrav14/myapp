import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MemoryType, SemanticMemoryMatch } from "../types.js";
import { embedText } from "./ai.service.js";

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface ConversationMemoryMatchRow {
  content_text: string;
  memory_type: string;
  metadata: unknown;
  similarity: number;
  created_at: string;
}

interface InsightMemoryMatchRow {
  raw_unfiltered_vent: string;
  similarity: number;
  logged_at: string;
  anxiety_score: number | null;
  core_emotional_driver: string | null;
}

export async function generateEmbeddingLiteral(input: {
  text: string;
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
}): Promise<string> {
  const values = await embedText(input);
  return toVectorLiteral(values);
}

export async function storeConversationMemory(input: {
  userId: string;
  memoryType: MemoryType;
  contentText: string;
  sourceMessageId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<void> {
  const trimmedText = input.contentText.trim();
  if (!trimmedText) {
    return;
  }

  const embedding = await generateEmbeddingLiteral({
    text: trimmedText,
    taskType: "RETRIEVAL_DOCUMENT"
  });

  const { error } = await supabase.from("conversation_memories").insert({
    user_id: input.userId,
    memory_type: input.memoryType,
    source_message_id: input.sourceMessageId ?? null,
    content_text: trimmedText,
    metadata: input.metadata ?? null,
    embedding
  });

  if (error) {
    throw new Error(`Failed to store conversation memory: ${error.message}`);
  }
}

export async function buildEmotionEmbedding(rawVentText: string): Promise<string> {
  return generateEmbeddingLiteral({
    text: rawVentText,
    taskType: "RETRIEVAL_DOCUMENT"
  });
}

export async function searchRelevantMemories(userId: string, queryText: string): Promise<SemanticMemoryMatch[]> {
  const trimmedQuery = queryText.trim();
  if (!trimmedQuery) {
    return [];
  }

  try {
    const queryEmbedding = await generateEmbeddingLiteral({
      text: trimmedQuery,
      taskType: "RETRIEVAL_QUERY"
    });

    const [conversationResult, insightResult] = await Promise.all([
      supabase.rpc("match_conversation_memories", {
        match_user_id: userId,
        query_embedding: queryEmbedding,
        match_count: 5
      }),
      supabase.rpc("match_insight_memories", {
        match_user_id: userId,
        query_embedding: queryEmbedding,
        match_count: 3
      })
    ]);

    const errors = [conversationResult.error, insightResult.error].filter(Boolean);
    if (errors.length > 0) {
      throw new Error(errors.map((error) => error?.message).join("; "));
    }

    const conversationRows = (conversationResult.data ?? []) as ConversationMemoryMatchRow[];
    const insightRows = (insightResult.data ?? []) as InsightMemoryMatchRow[];

    const conversationMemories: SemanticMemoryMatch[] = conversationRows
      .map((row) => ({
        source: "conversation_memory" as const,
        text: String(row.content_text),
        similarity: roundSimilarity(Number(row.similarity ?? 0)),
        created_at: String(row.created_at),
        memory_type: String(row.memory_type),
        metadata: isRecord(row.metadata) ? row.metadata : null
      }))
      .filter((row) => row.similarity > 0.55);

    const emotionMemories: SemanticMemoryMatch[] = insightRows
      .map((row) => ({
        source: "emotion_memory" as const,
        text: String(row.raw_unfiltered_vent),
        similarity: roundSimilarity(Number(row.similarity ?? 0)),
        created_at: String(row.logged_at),
        memory_type: "emotion_signal",
        anxiety_score: row.anxiety_score === null ? null : Number(row.anxiety_score),
        core_emotional_driver: row.core_emotional_driver ? String(row.core_emotional_driver) : null
      }))
      .filter((row) => row.similarity > 0.55);

    return [...conversationMemories, ...emotionMemories]
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 6);
  } catch (error) {
    logger.warn({ error, userId }, "Semantic memory lookup failed. Falling back to non-vector context.");
    return [];
  }
}
