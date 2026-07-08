import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import {
  messageRouterExtractionSchema,
  type MessageRouterExtraction,
  type ProfileDelta
} from "../schemas/message-router.js";
import type { MauriBrainDumpExtraction } from "../types.js";
import type { UserMindSource } from "../types.js";

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
  "location"
]);

export function profileDeltasToFactRows(
  deltas: ProfileDelta[],
  source: UserMindSource = "inferred"
): Array<{
  category: string;
  fact_key: string;
  fact_value: string;
  source: UserMindSource;
}> {
  return deltas.map((delta) => ({
    category: delta.category,
    fact_key: delta.fact_key,
    fact_value: delta.fact_value,
    source
  }));
}

export function hasMaterialProfileDeltas(deltas: ProfileDelta[] | undefined): boolean {
  if (!deltas?.length) {
    return false;
  }

  return deltas.some((delta) => MATERIAL_PROFILE_CATEGORIES.has(delta.category));
}

export function buildProfileDeltaAck(deltas: ProfileDelta[] | undefined): string | null {
  if (!hasMaterialProfileDeltas(deltas)) {
    return null;
  }

  const categories = new Set(deltas?.map((delta) => delta.category));

  if (categories.has("stressors") || categories.has("relationships")) {
    return "Got it — updated how I read your money pressure.";
  }

  if (categories.has("goals") || categories.has("life_context")) {
    return "Got it — updated what you're working toward.";
  }

  if (categories.has("location")) {
    return "Got it — updated where you're based.";
  }

  return "Got it — I've updated what I know about you.";
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
