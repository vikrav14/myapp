import { supabase } from "../lib/supabase.js";
import type { UserMindExtraction } from "../schemas/user-mind.js";
import type { MauriUser, UserMindFact, UserMindSource } from "../types.js";
import { extractUserMindProfile } from "./ai.service.js";

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

  return `Hey ${name}. I'm Mauri — your week in WhatsApp.

Before I track anything, I want to know you a bit — like a friend would.

Voice note is fine. Tell me:
what you do / what life looks like right now,
where you're based in Mauritius (area is enough),
what you're into,
and how you want me to show up — gentle, direct, short, whatever fits.

Reply skip if you'd rather jump in. I'll learn as we go.`;
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
}): string {
  const name = input.user.first_name?.trim() || "there";

  if (input.skipped || input.facts.length === 0) {
    return `No stress, ${name}. We'll build this as we go.

Pick a starting lane for your 7 AM pulse — closest fit is fine, or build your own.

Student Grind.
Corporate / Career.
Entrepreneur Mode.
Life & Habit Tracking.
My Own Mix — your tags, your mix, no preset box.

Reply with the exact one, or send 1, 2, 3, 4, or 5.`;
  }

  const highlights: string[] = [];
  for (const fact of input.facts) {
    if (fact.category === "identity" && fact.fact_key === "preferred_name") {
      continue;
    }
    if (["identity", "location", "life_context", "preferences"].includes(fact.category)) {
      highlights.push(fact.fact_value);
    }
  }

  const summary =
    highlights.length > 0
      ? highlights.slice(0, 4).join(". ")
      : "I've got the basics saved.";

  return `Got it, ${name}. ${summary}

I'll hold that as *you*, not just your logs.

Now pick a starting lane for your 7 AM pulse — closest fit is fine, or build your own.

Student Grind.
Corporate / Career.
Entrepreneur Mode.
Life & Habit Tracking.
My Own Mix — your tags, your mix, no preset box.

Reply with the exact one, or send 1, 2, 3, 4, or 5.`;
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

export async function ingestUserMindMessage(input: {
  userId: string;
  message: string;
  source: UserMindSource;
}): Promise<UserMindFact[]> {
  const extraction = await extractUserMindProfile(input.message);
  const rows = extractionToFactRows(extraction, input.source);
  return upsertUserMindFacts({ userId: input.userId, rows });
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
      reply: `I don't have anything stored that matches "${input.query.trim()}". Reply what do you know about me to see your profile.`
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
  const name = user.first_name?.trim() || "You";

  if (facts.length === 0) {
    return `${name}, I don't have much on you yet beyond WhatsApp basics.

Tell me in onboarding style — or reply remember that I live in Quatre Bornes / I hate guilt trips / I'm into football.`;
  }

  const lines = [`${name}, here's what I hold about *you* (not just this week's logs):`, ""];

  const grouped = new Map<string, UserMindFact[]>();
  for (const fact of facts) {
    const bucket = grouped.get(fact.category) ?? [];
    bucket.push(fact);
    grouped.set(fact.category, bucket);
  }

  const labels: Record<string, string> = {
    identity: "Identity",
    location: "Where you're based",
    life_context: "Life & work",
    interests: "Interests",
    goals: "Goals",
    stressors: "What's heavy",
    preferences: "How to show up",
    boundaries: "Boundaries",
    relationships: "People",
    user_stated: "You told me"
  };

  for (const [category, categoryFacts] of grouped.entries()) {
    lines.push(`${labels[category] ?? category}:`);
    for (const fact of categoryFacts) {
      if (category === "identity" && fact.fact_key === "preferred_name") {
        lines.push(`- Call you: ${fact.fact_value}`);
      } else {
        lines.push(`- ${fact.fact_value}`);
      }
    }
    lines.push("");
  }

  lines.push(`Wrong or outdated? Reply forget that … or remember that …`);

  return lines.join("\n").trim();
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
    normalized === "who am i to you"
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
    const facts = await loadUserMindFacts(input.user.id);
    return {
      handled: true,
      reply: buildUserMindProfileReply(input.user, facts)
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
      reply: `Noted. I'll read you with that in mind going forward.`
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
