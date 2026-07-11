import { buildRememberFactAck } from "../lib/strategic-transparency.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { ProfileDelta } from "../schemas/message-router.js";
import { messageRouterExtractionSchema } from "../schemas/message-router.js";
import type { UserMindExtraction } from "../schemas/user-mind.js";
import type { MauriUser, UserMindFact, UserMindSource } from "../types.js";
import { buildArchetypeLaneList } from "./archetype-catalog.js";
import { extractUserMindProfile, generateKnowYouAcknowledgement, routeInboundMessage } from "./ai.service.js";
import { cancelPendingOpenLoopFollowUps } from "./open-loop-follow-up.service.js";
import {
  buildMauriMemoryViewFromData,
  formatMauriMemoryViewForWhatsApp,
  loadMauriMemoryView
} from "./mauri-memory-view.service.js";

function slugifyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function mapFact(record: Record<string, unknown>): UserMindFact {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    category: String(record.category),
    fact_key: String(record.fact_key),
    fact_value: String(record.fact_value),
    source: String(record.source),
    confidence: Number(record.confidence ?? 1),
    user_visible: Boolean(record.user_visible ?? true),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export function extractionToFactRows(
  extraction: UserMindExtraction,
  source: UserMindSource
): Array<{
  category: string;
  fact_key: string;
  fact_value: string;
  source: UserMindSource;
}> {
  const rows: Array<{
    category: string;
    fact_key: string;
    fact_value: string;
    source: UserMindSource;
  }> = [];

  const push = (category: string, fact_key: string, fact_value: string | undefined | null) => {
    const trimmed = fact_value?.trim();
    if (!trimmed) {
      return;
    }

    rows.push({ category, fact_key, fact_value: trimmed, source });
  };

  push("identity", "preferred_name", extraction.preferred_name ?? null);
  if (extraction.age !== undefined) {
    push("identity", "age", String(extraction.age));
  }
  push("identity", "age_band", extraction.age_band ?? null);
  push("location", "area", extraction.area ?? null);
  push("life_context", "work", extraction.work ?? null);
  push("life_context", "life_situation", extraction.life_situation ?? null);
  push("preferences", "tone", extraction.tone_preference ?? null);

  for (const interest of extraction.interests ?? []) {
    push("interests", slugifyKey(interest) || "interest", interest);
  }

  for (const goal of extraction.goals ?? []) {
    push("goals", slugifyKey(goal) || "goal", goal);
  }

  for (const stressor of extraction.stressors ?? []) {
    push("stressors", slugifyKey(stressor) || "stressor", stressor);
  }

  for (const boundary of extraction.boundaries ?? []) {
    push("boundaries", slugifyKey(boundary) || "boundary", boundary);
  }

  for (const relationship of extraction.relationships ?? []) {
    const key = slugifyKey(relationship.label) || "person";
    const value = relationship.note?.trim()
      ? `${relationship.label} — ${relationship.note}`
      : relationship.label;
    push("relationships", key, value);
  }

  return rows;
}

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
    fact_key: delta.fact_key.trim().slice(0, 48),
    fact_value: delta.fact_value.trim().slice(0, 500),
    source
  }));
}

export function extractBasicKnowYouFactsFromMessage(
  message: string,
  source: UserMindSource = "onboarding"
): Array<{
  category: string;
  fact_key: string;
  fact_value: string;
  source: UserMindSource;
}> {
  const trimmed = message.trim();
  if (!trimmed) {
    return [];
  }

  const rows: Array<{
    category: string;
    fact_key: string;
    fact_value: string;
    source: UserMindSource;
  }> = [];

  const push = (category: string, fact_key: string, fact_value: string | null | undefined) => {
    const value = fact_value?.trim();
    if (!value) {
      return;
    }

    rows.push({
      category,
      fact_key: fact_key.slice(0, 48),
      fact_value: value.slice(0, 500),
      source
    });
  };

  const ageMatch = trimmed.match(/\b(?:i['’]?m|i am)\s*(\d{1,2})\b/i);
  if (ageMatch?.[1]) {
    push("identity", "age", ageMatch[1]);
  }

  const areaMatch =
    trimmed.match(/\bbased in\s+([^.,\n]+)/i) ??
    trimmed.match(/\blive in\s+([^.,\n]+)/i) ??
    trimmed.match(/\bfrom\s+([^.,\n]+)/i);
  if (areaMatch?.[1]) {
    push("location", "area", areaMatch[1].trim());
  }

  const workMatch =
    trimmed.match(/\b(?:i run|i own)\s+(?:a\s+)?([^.,\n]+)/i) ??
    trimmed.match(/\b(?:working in|work in|i['’]?m a)\s+([^.,\n]+)/i);
  if (workMatch?.[1]) {
    push("life_context", "work", workMatch[1].trim());
  }

  const goalMatch = trimmed.match(/\b(?:i just need|i need|working toward|trying to)\s+([^.,\n]+)/i);
  if (goalMatch?.[1]) {
    push("goals", "primary_goal", goalMatch[1].trim());
  }

  if (/\b(rent|drowning|debt|loan|uncle|tension|no sleep|new dad|baby|son|daughter|collapsed)\b/i.test(trimmed)) {
    push("stressors", "onboarding_pressure", trimmed.slice(0, 200));
  }

  push("user_stated", "onboarding_intro", trimmed.slice(0, 500));

  return rows;
}

export async function loadUserMindFacts(userId: string): Promise<UserMindFact[]> {
  const { data, error } = await supabase
    .from("user_mind_facts")
    .select("*")
    .eq("user_id", userId)
    .eq("user_visible", true)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load user mind facts: ${error.message}`);
  }

  return (data ?? []).map((row) => mapFact(row as Record<string, unknown>));
}

/** Clears stale profile data when a user re-submits know-you during onboarding (e.g. test number reuse). */
export async function resetProfileForKnowYouOnboarding(userId: string): Promise<void> {
  const { error: factsError } = await supabase.from("user_mind_facts").delete().eq("user_id", userId);

  if (factsError) {
    throw new Error(`Failed to reset user mind facts for onboarding: ${factsError.message}`);
  }

  const { error: snapshotError } = await supabase.from("user_mind_snapshots").delete().eq("user_id", userId);

  if (snapshotError) {
    throw new Error(`Failed to reset user mind snapshot for onboarding: ${snapshotError.message}`);
  }

  const { error: memoriesError } = await supabase.from("conversation_memories").delete().eq("user_id", userId);

  if (memoriesError) {
    throw new Error(`Failed to reset conversation memories for onboarding: ${memoriesError.message}`);
  }

  const { error: insightsError } = await supabase.from("insights_vault").delete().eq("user_id", userId);

  if (insightsError) {
    throw new Error(`Failed to reset insights for onboarding: ${insightsError.message}`);
  }

  await cancelPendingOpenLoopFollowUps(userId).catch((error) => {
    logger.warn({ error, userId }, "Failed to cancel pending follow-ups during know-you reset.");
  });
}

export function formatUserMindForPrompt(facts: UserMindFact[]): string {
  if (facts.length === 0) {
    return "No explicit person profile yet.";
  }

  const grouped = new Map<string, string[]>();
  for (const fact of facts) {
    const lines = grouped.get(fact.category) ?? [];
    lines.push(`${fact.fact_key}: ${fact.fact_value}`);
    grouped.set(fact.category, lines);
  }

  return Array.from(grouped.entries())
    .map(([category, lines]) => `${category}: ${lines.join("; ")}`)
    .join("\n");
}

export function buildKnowYouPrompt(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";

  return `Hey ${name} 👋 I'm Mauri — your whole week in WhatsApp.

Before I track anything, I want to know you like a friend who's here all week — not ChatGPT that resets tomorrow.

🌅 7am — weather, traffic & stories AI picks for YOUR tags (personal stuff stays out of that)
💬 All day — brain dumps, receipt snaps, reminders when you ask
🧠 Memory + 15 playbooks — my memory shows what I've learned; my playbook draws on Atomic Habits, Psychology of Money & more (one step, not homework)
📊 Sunday — roast or hype, your week in numbers, squad showdown if you're in a pact

Built for the Mauritian juggle. High corporate stakes, heavy family loads, and the chaos of the commute. Meet your silent strategist.

30-second voice note — rough is fine. Tell me whatever comes to mind:

• your age (or rough — "mid-20s" is fine)
• what life looks like right now — work, study, hustle, family
• where you're based in Mauritius (area / commute is enough)
• what you're into or chasing this year
• what's heavy right now (optional but helps)
• how you want me to show up — and what to avoid

Example (voice note or text — rough is fine):
"Hey Mauri, I'm 31, working in a management company in Grand Baie but living in Vacoas. The winter rain and traffic are killing me. I make okay money, but my parents took a massive loan for my wedding last year and now they expect me to pay the monthly installments because my dad got laid off from his factory job. I want to build a side hustle in digital marketing at night to break out of this 9-to-5 loop, but by 8 PM my brain is completely fried and I just stare at the TV. I feel like a failure because I can't find the energy to change my life."

This stays between us 🔒 and shapes how I remember you.

Reply skip to jump in — I'll learn as we go ✌️`;
}

function summarizeKnowYouFactsForAck(facts: UserMindFact[]): string {
  const paragraphs: string[] = [];

  const relationships = facts.filter((fact) => fact.category === "relationships");
  const stressors = facts.filter((fact) => fact.category === "stressors");
  const heavyBits = [
    ...stressors.map((fact) => fact.fact_value),
    ...relationships.map((fact) => fact.fact_value)
  ].slice(0, 4);

  if (heavyBits.length > 0) {
    paragraphs.push(`I hear you on ${heavyBits.join(", ")} — that's a lot to carry.`);
  }

  const contextParts: string[] = [];
  const ageFact = facts.find((fact) => fact.category === "identity" && fact.fact_key === "age");
  const ageBandFact = facts.find((fact) => fact.category === "identity" && fact.fact_key === "age_band");
  if (ageFact) {
    contextParts.push(`${ageFact.fact_value}`);
  } else if (ageBandFact) {
    contextParts.push(ageBandFact.fact_value);
  }

  const areaFact = facts.find((fact) => fact.category === "location" && fact.fact_key === "area");
  if (areaFact) {
    contextParts.push(`in ${areaFact.fact_value}`);
  }

  const workFact = facts.find((fact) => fact.category === "life_context" && fact.fact_key === "work");
  const lifeFact = facts.find((fact) => fact.category === "life_context" && fact.fact_key === "life_situation");
  if (workFact) {
    contextParts.push(workFact.fact_value);
  } else if (lifeFact) {
    contextParts.push(lifeFact.fact_value);
  }

  const interests = facts
    .filter((fact) => fact.category === "interests")
    .map((fact) => fact.fact_value)
    .slice(0, 2);
  if (interests.length > 0) {
    contextParts.push(`into ${interests.join(" and ")}`);
  }

  const goalFact = facts.find((fact) => fact.category === "goals");
  if (goalFact) {
    contextParts.push(`working toward ${goalFact.fact_value}`);
  }

  if (contextParts.length > 0) {
    const opener = heavyBits.length > 0 ? "I've also got" : "I've got";
    paragraphs.push(`${opener} you as ${contextParts.join(", ")}.`);
  }

  if (paragraphs.length === 0) {
    return "I've got the basics saved.";
  }

  return paragraphs.join("\n\n");
}

function shouldUseKnowYouAiAcknowledgement(message: string, facts: UserMindFact[]): boolean {
  if (message.trim().length >= 100) {
    return true;
  }

  return facts.some((fact) => fact.category === "stressors" || fact.category === "relationships");
}

const KNOW_YOU_CORRECTION_SUFFIX = "Wrong or missing something? Just correct me in chat.";

function stripDuplicateKnowYouCorrection(reply: string): string {
  return reply
    .replace(/\n\n?(wrong or missing something\??[^\n]*|just (let me know|correct me)[^\n]*)\.?$/i, "")
    .trim();
}

export async function resolveKnowYouAcknowledgement(input: {
  user: MauriUser;
  message: string;
  facts: UserMindFact[];
  skipped: boolean;
  compact?: boolean;
}): Promise<string> {
  if (input.skipped || input.facts.length === 0) {
    return buildKnowYouAcknowledgement({
      user: input.user,
      facts: input.facts,
      skipped: true,
      ...(input.compact !== undefined ? { compact: input.compact } : {})
    });
  }

  const name = input.user.first_name?.trim() || "there";

  if (shouldUseKnowYouAiAcknowledgement(input.message, input.facts)) {
    try {
      const aiReply = stripDuplicateKnowYouCorrection(
        await generateKnowYouAcknowledgement({
          firstName: name,
          message: input.message,
          factsSummary: formatUserMindForPrompt(input.facts)
        })
      );

      return `${aiReply}\n\n${KNOW_YOU_CORRECTION_SUFFIX}`;
    } catch (error) {
      logger.warn({ error, userId: input.user.id }, "Know-you AI acknowledgement failed; using template.");
    }
  }

  return buildKnowYouAcknowledgement({
    user: input.user,
    facts: input.facts,
    skipped: false,
    ...(input.compact !== undefined ? { compact: input.compact } : {})
  });
}

export function isKnowYouSkipMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "skip" ||
    normalized === "later" ||
    normalized === "not now" ||
    normalized === "pass" ||
    normalized === "next"
  );
}

export function isKnowYouTooShort(message: string): boolean {
  return message.trim().length < 12;
}

export function buildKnowYouAcknowledgement(input: {
  user: MauriUser;
  facts: UserMindFact[];
  skipped: boolean;
  compact?: boolean;
}): string {
  const name = input.user.first_name?.trim() || "there";

  if (input.skipped || input.facts.length === 0) {
    if (input.compact) {
      return `No stress, ${name}. We'll build this as we go.`;
    }

    return `No stress, ${name}. We'll build this as we go.

Pick a starting lane for your 7 AM pulse — closest fit is fine, or build your own.

${buildArchetypeLaneList()}`;
  }

  const summary = summarizeKnowYouFactsForAck(input.facts);

  if (input.compact) {
    return `${name} — thanks for sharing that with me.

${summary}

I'll hold that as *you*, not just your logs. Reply my memory anytime to see it structured. Wrong or missing something? Just correct me in chat.`;
  }

  return `${name} — thanks for sharing that with me.

${summary}

I'll hold that as *you*, not just your logs. Reply my memory anytime to see it structured. Wrong or missing something? Just correct me in chat.

Now pick a starting lane for your 7 AM pulse — closest fit is fine, or build your own.

${buildArchetypeLaneList()}`;
}

export async function upsertUserMindFacts(input: {
  userId: string;
  rows: Array<{
    category: string;
    fact_key: string;
    fact_value: string;
    source: UserMindSource;
    confidence?: number | undefined;
  }>;
}): Promise<UserMindFact[]> {
  if (input.rows.length === 0) {
    return loadUserMindFacts(input.userId);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_mind_facts")
    .upsert(
      input.rows.map((row) => ({
        user_id: input.userId,
        category: row.category,
        fact_key: row.fact_key,
        fact_value: row.fact_value,
        source: row.source,
        confidence: row.confidence ?? 1,
        user_visible: true,
        updated_at: now
      })),
      { onConflict: "user_id,category,fact_key" }
    )
    .select("*");

  if (error) {
    throw new Error(`Failed to upsert user mind facts: ${error.message}`);
  }

  return (data ?? []).map((row) => mapFact(row as Record<string, unknown>));
}

function formatProcessingError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function ingestUserMindMessage(input: {
  userId: string;
  message: string;
  source: UserMindSource;
}): Promise<UserMindFact[]> {
  if (env.MESSAGE_ROUTER_MODE === "commit") {
    try {
      const routerRaw = await routeInboundMessage({
        message: input.message,
        mode: "onboarding"
      });
      const parsed = messageRouterExtractionSchema.safeParse(routerRaw);
      if (parsed.success) {
        const normalized = parsed.data;
        if (normalized.confidence !== "low" && normalized.profile_deltas?.length) {
          const rows = profileDeltasToFactRows(normalized.profile_deltas, input.source);
          if (rows.length >= 1) {
            return upsertUserMindFacts({ userId: input.userId, rows });
          }
        }
      } else {
        logger.warn(
          { userId: input.userId, issues: parsed.error.issues },
          "Know-you router response failed schema validation."
        );
      }
    } catch (error) {
      logger.warn(
        {
          error,
          userId: input.userId,
          stage: "router_call",
          errorMessage: formatProcessingError(error)
        },
        "Know-you router ingest failed; falling back to legacy extractor."
      );
    }
  }

  try {
    const extraction = await extractUserMindProfile(input.message);
    const rows = extractionToFactRows(extraction, input.source);
    if (rows.length >= 1) {
      return upsertUserMindFacts({ userId: input.userId, rows });
    }

    logger.warn(
      { userId: input.userId, stage: "legacy_empty" },
      "Legacy know-you extract returned no fact rows; using basic fallback."
    );
  } catch (error) {
    logger.warn(
      {
        error,
        userId: input.userId,
        stage: "legacy_call",
        errorMessage: formatProcessingError(error)
      },
      "Legacy know-you extract failed; using basic fallback."
    );
  }

  const basicRows = extractBasicKnowYouFactsFromMessage(input.message, input.source);
  if (basicRows.length === 0) {
    throw new Error("Could not extract any know-you facts from the message.");
  }

  return upsertUserMindFacts({ userId: input.userId, rows: basicRows });
}

export async function storeFreeformUserMindFact(input: {
  userId: string;
  message: string;
  source?: UserMindSource | undefined;
}): Promise<UserMindFact[]> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    return loadUserMindFacts(input.userId);
  }

  const key = `note_${slugifyKey(trimmed).slice(0, 32) || Date.now()}`;
  return upsertUserMindFacts({
    userId: input.userId,
    rows: [
      {
        category: "user_stated",
        fact_key: key,
        fact_value: trimmed,
        source: input.source ?? "user_stated"
      }
    ]
  });
}

export async function deleteUserMindFactsMatching(input: {
  userId: string;
  query: string;
}): Promise<{ deleted: number; reply: string }> {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { deleted: 0, reply: "Tell me what to forget — e.g. forget that I live in Beau Bassin." };
  }

  const facts = await loadUserMindFacts(input.userId);
  const matches = facts.filter(
    (fact) =>
      fact.fact_value.toLowerCase().includes(normalizedQuery) ||
      fact.fact_key.toLowerCase().includes(normalizedQuery)
  );

  if (matches.length === 0) {
    return {
      deleted: 0,
      reply: `I don't have anything stored that matches "${input.query.trim()}". Reply my memory to see your structured profile.`
    };
  }

  const ids = matches.map((fact) => fact.id);
  const { error } = await supabase.from("user_mind_facts").delete().in("id", ids);

  if (error) {
    throw new Error(`Failed to delete user mind facts: ${error.message}`);
  }

  return {
    deleted: matches.length,
    reply: `Done — removed ${matches.length} thing${matches.length === 1 ? "" : "s"} about "${input.query.trim()}".`
  };
}

export function buildUserMindProfileReply(user: MauriUser, facts: UserMindFact[]): string {
  const view = buildMauriMemoryViewFromData({ user, facts });
  return formatMauriMemoryViewForWhatsApp(user, view);
}

export function parseUserMindCommand(
  message: string
): { type: "profile" } | { type: "remember"; text: string } | { type: "forget"; text: string } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "what do you know about me" ||
    normalized === "what do you know about me?" ||
    normalized === "my profile" ||
    normalized === "about me" ||
    normalized === "who am i to you" ||
    normalized === "my memory" ||
    normalized === "mauri memory" ||
    normalized === "how do you see me" ||
    normalized === "how do you see me?"
  ) {
    return { type: "profile" };
  }

  const rememberMatch = message.trim().match(/^remember(?:\s+that)?[:\s]+(.+)$/i);
  if (rememberMatch?.[1]) {
    return { type: "remember", text: rememberMatch[1].trim() };
  }

  const forgetMatch = message.trim().match(/^forget(?:\s+that)?[:\s]+(.+)$/i);
  if (forgetMatch?.[1]) {
    return { type: "forget", text: forgetMatch[1].trim() };
  }

  return null;
}

export async function handleUserMindCommandMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<{ handled: boolean; reply?: string | undefined }> {
  const command = parseUserMindCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (command.type === "profile") {
    const view = await loadMauriMemoryView(input.user);
    return {
      handled: true,
      reply: formatMauriMemoryViewForWhatsApp(input.user, view)
    };
  }

  if (command.type === "remember") {
    await ingestUserMindMessage({
      userId: input.user.id,
      message: command.text,
      source: "user_stated"
    });
    return {
      handled: true,
      reply: buildRememberFactAck(command.text)
    };
  }

  const result = await deleteUserMindFactsMatching({
    userId: input.user.id,
    query: command.text
  });

  return {
    handled: true,
    reply: result.reply
  };
}

export function preferredNameFromFacts(facts: UserMindFact[]): string | null {
  const match = facts.find(
    (fact) => fact.category === "identity" && fact.fact_key === "preferred_name"
  );
  return match?.fact_value ?? null;
}
