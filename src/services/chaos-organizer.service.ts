import type { UserMindFact } from "../types.js";
import { combinedFactBlob } from "./profile-inference.service.js";

export type ChaosMapLineKey = "money" | "home" | "family" | "work" | "goals" | "live";

export interface ChaosMapLine {
  key: ChaosMapLineKey;
  emoji: string;
  label: string;
  detail: string;
}

/** User is carrying multiple live stressors — needs a map, not a therapy essay. */
export function isChaosProfile(facts: UserMindFact[], message?: string): boolean {
  const stressorCount = facts.filter((fact) => fact.category === "stressors").length;
  const relationshipStress = facts.filter((fact) => fact.category === "relationships").length;
  const blob = `${combinedFactBlob(facts)} ${message ?? ""}`.toLowerCase();

  if (stressorCount >= 2 || (stressorCount >= 1 && relationshipStress >= 1)) {
    return true;
  }

  return (
    /\b(overwhelm|chaos|a lot at once|everything at once|can't cope|cannot cope|panicking|drowning)\b/i.test(blob) &&
    blob.length >= 80
  );
}

function pickFactValues(facts: UserMindFact[], category: string, limit = 2): string[] {
  return facts
    .filter((fact) => fact.category === category)
    .map((fact) => fact.fact_value.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function shortenFact(value: string, max = 72): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function shortenFocusDetail(value: string, max = 48): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1).trim()}…`;
}

export function buildChaosMapLines(facts: UserMindFact[]): ChaosMapLine[] {
  const money = pickFactValues(facts, "stressors").filter((value) =>
    /\b(rent|loan|money|debt|cash|shop|tourism|uncle|bank|wedding|repay)\b/i.test(value)
  );
  const family = pickFactValues(facts, "relationships");
  const home = pickFactValues(facts, "stressors").filter((value) =>
    /\b(baby|sleep|son|daughter|child|exhaust|tired)\b/i.test(value)
  );
  const work = pickFactValues(facts, "life_context", 1);
  const goals = pickFactValues(facts, "goals", 1);
  const lines: ChaosMapLine[] = [];

  if (money.length > 0) {
    lines.push({
      key: "money",
      emoji: "🧾",
      label: "Money",
      detail: shortenFact(money.join("; "))
    });
  }

  if (home.length > 0) {
    lines.push({
      key: "home",
      emoji: "🏠",
      label: "Home",
      detail: shortenFact(home.join("; "))
    });
  } else if (family.length > 0) {
    lines.push({
      key: "family",
      emoji: "👪",
      label: "Family",
      detail: shortenFact(family.join("; "))
    });
  }

  if (work.length > 0) {
    lines.push({
      key: "work",
      emoji: "🏪",
      label: "Work",
      detail: shortenFact(work[0]!)
    });
  }

  if (goals.length > 0) {
    lines.push({
      key: "goals",
      emoji: "🎯",
      label: "Aiming for",
      detail: shortenFact(goals[0]!)
    });
  }

  if (lines.length === 0) {
    const fallback = pickFactValues(facts, "stressors", 2);
    if (fallback.length > 0) {
      lines.push({
        key: "live",
        emoji: "📌",
        label: "Live",
        detail: shortenFact(fallback.join("; "))
      });
    }
  }

  return lines;
}

export function formatChaosMapLine(line: ChaosMapLine): string {
  return `${line.emoji} ${line.label}: ${line.detail}`;
}

export function buildChaosOrganizerMap(input: {
  firstName?: string | null;
  facts: UserMindFact[];
}): string {
  const name = input.firstName?.trim() || "there";
  const lines = buildChaosMapLines(input.facts);

  if (lines.length === 0) {
    return `${name} — I hear it's a lot. One pin at a time beats a spiral. What's the single thread you want to tackle first?`;
  }

  return [
    `${name} — here's your map (not more homework):`,
    "",
    lines.map((line) => formatChaosMapLine(line)).join("\n"),
    "",
    "One pin this week beats trying to fix everything at once. Which line should we tackle first?"
  ].join("\n");
}

export function parseChaosPinCommand(message: string): { key: ChaosMapLineKey } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  const match = normalized.match(/^chaos pin (money|home|family|work|goals|live)$/);
  if (!match?.[1]) {
    return null;
  }

  return { key: match[1] as ChaosMapLineKey };
}

export function inferWeeklyFocusFromChaosLine(line: ChaosMapLine): string {
  const detail = shortenFocusDetail(line.detail);

  if (line.key === "money") {
    return `One money move on ${detail} — log before you react`;
  }

  if (line.key === "family") {
    return `One family boundary on ${detail} — log it when it happens`;
  }

  if (line.key === "home") {
    return `One small win at home (${detail}) — log when it lands`;
  }

  if (line.key === "work") {
    return `One focused block on ${detail} — no scrolling`;
  }

  if (line.key === "goals") {
    return `One step toward ${detail} — log it when you do it`;
  }

  return `One pin on ${detail} this week — log when it happens`;
}

export function buildChaosPinSelectionReply(input: {
  firstName?: string | null;
  line: ChaosMapLine;
  weeklyFocus: string;
}): string {
  const name = input.firstName?.trim() || "there";
  return `${input.line.label} it is, ${name} — one pin this week:\n${input.weeklyFocus}\n\nTap Start my trial when you're ready.`;
}

export const CHAOS_ORGANIZER_AI_RULES = `- CHAOS ORGANIZER MODE: user is overwhelmed. Act as a calm project manager, not a therapist.
- Max 3 short labeled lines (emoji + topic + one fact from their profile only).
- Then ONE concrete next step. No empathy walls. No invented crises.
- BANNED unless explicitly in profile facts: loan sharks, crypto, electricity bills, threats, violence, dad, factory, biopsy, drinking spiral.
- Max 90 words.`;
