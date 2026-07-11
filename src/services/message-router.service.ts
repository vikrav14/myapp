import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { buildUnifiedCaptureAck } from "../lib/strategic-transparency.js";
import {
  messageRouterExtractionSchema,
  type MessageRouterExtraction,
  type ProfileDelta
} from "../schemas/message-router.js";
import type { MauriBrainDumpExtraction } from "../types.js";
import { completeMatchedTodos, persistExtraction } from "./logging.service.js";
import { profileDeltasToFactRows, upsertUserMindFacts } from "./user-mind.service.js";

export type MessageRouterMode = "off" | "shadow" | "commit";

export function getMessageRouterMode(): MessageRouterMode {
  return env.MESSAGE_ROUTER_MODE;
}

export function shouldRunMessageRouterShadow(): boolean {
  return env.MESSAGE_ROUTER_MODE === "shadow";
}

export function shouldCommitMessageRouterWrites(): boolean {
  return env.MESSAGE_ROUTER_MODE === "commit";
}

const MATERIAL_PROFILE_CATEGORIES = new Set<ProfileDelta["category"]>([
  "goals",
  "stressors",
  "relationships",
  "life_context",
  "location",
  "interests",
  "boundaries"
]);

export function hasMaterialProfileDeltas(deltas: ProfileDelta[] | undefined): boolean {
  if (!deltas?.length) {
    return false;
  }

  return deltas.some((delta) => MATERIAL_PROFILE_CATEGORIES.has(delta.category));
}

export function buildProfileDeltaAck(deltas: ProfileDelta[] | undefined): string | null {
  return buildUnifiedCaptureAck({ profileDeltas: deltas });
}

export function appendProfileDeltaAck(reply: string, ack: string | null | undefined): string {
  const trimmedAck = ack?.trim();
  if (!trimmedAck) {
    return reply.trim();
  }

  return `${reply.trim()}\n\n${trimmedAck}`;
}

export function normalizeRouterExtraction(
  extraction: MessageRouterExtraction
): MessageRouterExtraction {
  const normalized = messageRouterExtractionSchema.parse(extraction);

  if (normalized.confidence === "low") {
    return {
      intent: normalized.intent === "mixed" ? "chat_only" : normalized.intent,
      confidence: "low"
    };
  }

  return normalized;
}

export function routerToStructuredExtraction(router: MessageRouterExtraction): MauriBrainDumpExtraction {
  const normalized = normalizeRouterExtraction(router);
  return normalized.structured ?? {};
}

export async function commitRouterExtraction(input: {
  userId: string;
  router: MessageRouterExtraction;
}): Promise<{
  extraction: MauriBrainDumpExtraction;
  profileDeltas: ProfileDelta[];
  completedTodoCount: number;
}> {
  const normalized = normalizeRouterExtraction(input.router);
  const extraction = routerToStructuredExtraction(normalized);

  await persistExtraction(input.userId, extraction);

  let completedTodoCount = 0;
  if (normalized.todo_completions?.length) {
    completedTodoCount = await completeMatchedTodos({
      userId: input.userId,
      taskMatches: normalized.todo_completions.map((completion) => completion.task_match)
    });
  }

  if (normalized.profile_deltas?.length) {
    await upsertUserMindFacts({
      userId: input.userId,
      rows: profileDeltasToFactRows(normalized.profile_deltas)
    });
  }

  return {
    extraction,
    profileDeltas: normalized.profile_deltas ?? [],
    completedTodoCount
  };
}

export function mergeStructuredExtractions(
  legacy: MauriBrainDumpExtraction,
  router: MessageRouterExtraction | undefined
): MauriBrainDumpExtraction {
  if (!router?.structured || router.confidence === "low") {
    return legacy;
  }

  if (shouldCommitMessageRouterWrites()) {
    return router.structured;
  }

  return {
    finance: router.structured.finance ?? legacy.finance,
    habits: router.structured.habits ?? legacy.habits,
    todos: router.structured.todos?.length ? router.structured.todos : legacy.todos,
    emotions: router.structured.emotions ?? legacy.emotions
  };
}

export function diffRouterExtractions(input: {
  legacy: MauriBrainDumpExtraction;
  router: MessageRouterExtraction;
}): string[] {
  const diffs: string[] = [];

  const legacyKeys = structuredKeys(input.legacy);
  const routerKeys = input.router.structured ? structuredKeys(input.router.structured) : [];

  for (const key of routerKeys) {
    if (!legacyKeys.includes(key)) {
      diffs.push(`router_only:structured.${key}`);
    }
  }

  for (const key of legacyKeys) {
    if (!routerKeys.includes(key)) {
      diffs.push(`legacy_only:structured.${key}`);
    }
  }

  if (input.router.profile_deltas?.length) {
    for (const delta of input.router.profile_deltas) {
      diffs.push(`router_only:profile_delta.${delta.category}.${delta.fact_key}`);
    }
  }

  if (input.router.todo_completions?.length) {
    diffs.push(`router_only:todo_completions.${input.router.todo_completions.length}`);
  }

  if (input.router.intent === "chat_only" && legacyKeys.length > 0) {
    diffs.push("intent_mismatch:router_chat_only_legacy_structured");
  }

  if (
    (input.router.intent === "structured_log" || input.router.intent === "mixed") &&
    routerKeys.length === 0 &&
    legacyKeys.length === 0
  ) {
    diffs.push("intent_mismatch:structured_intent_no_writes");
  }

  return diffs;
}

function structuredKeys(extraction: MauriBrainDumpExtraction): string[] {
  const keys: string[] = [];

  if (extraction.finance) {
    keys.push("finance");
  }

  if (extraction.habits) {
    keys.push("habits");
  }

  if (extraction.todos?.length) {
    keys.push("todos");
  }

  if (extraction.emotions) {
    keys.push("emotions");
  }

  return keys;
}

export function logShadowRouterComparison(input: {
  userId: string;
  messagePreview: string;
  legacy: MauriBrainDumpExtraction;
  router: MessageRouterExtraction;
}): void {
  const diff = diffRouterExtractions({
    legacy: input.legacy,
    router: input.router
  });

  if (diff.length === 0) {
    return;
  }

  logger.info(
    {
      userId: input.userId,
      messagePreview: input.messagePreview.slice(0, 120),
      routerIntent: input.router.intent,
      routerConfidence: input.router.confidence ?? "unspecified",
      diff
    },
    "Message router shadow diff."
  );
}
