import type { UserMindFact } from "../types.js";
import { combinedFactBlob } from "./profile-inference.service.js";

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

export function buildChaosOrganizerMap(input: {
  firstName?: string | null;
  facts: UserMindFact[];
}): string {
  const name = input.firstName?.trim() || "there";
  const money = pickFactValues(input.facts, "stressors").filter((value) =>
    /\b(rent|loan|money|debt|cash|shop|tourism|uncle|bank)\b/i.test(value)
  );
  const family = pickFactValues(input.facts, "relationships");
  const home = pickFactValues(input.facts, "stressors").filter((value) =>
    /\b(baby|sleep|son|daughter|child|exhaust|tired)\b/i.test(value)
  );
  const work = pickFactValues(input.facts, "life_context", 1);
  const goals = pickFactValues(input.facts, "goals", 1);

  const lines: string[] = [];

  if (money.length > 0) {
    lines.push(`🧾 Money: ${shortenFact(money.join("; "))}`);
  }

  if (home.length > 0) {
    lines.push(`🏠 Home: ${shortenFact(home.join("; "))}`);
  } else if (family.length > 0) {
    lines.push(`👪 Family: ${shortenFact(family.join("; "))}`);
  }

  if (work.length > 0) {
    lines.push(`🏪 Work: ${shortenFact(work[0]!)}`);
  }

  if (goals.length > 0) {
    lines.push(`🎯 Aiming for: ${shortenFact(goals[0]!)}`);
  }

  if (lines.length === 0) {
    const fallback = pickFactValues(input.facts, "stressors", 2);
    if (fallback.length > 0) {
      lines.push(`📌 Live: ${shortenFact(fallback.join("; "))}`);
    }
  }

  if (lines.length === 0) {
    return `${name} — I hear it's a lot. One pin at a time beats a spiral. What's the single thread you want to tackle first?`;
  }

  return [
    `${name} — here's your map (not more homework):`,
    "",
    lines.join("\n"),
    "",
    "One pin this week beats trying to fix everything at once. Which line should we tackle first?"
  ].join("\n");
}

export const CHAOS_ORGANIZER_AI_RULES = `- CHAOS ORGANIZER MODE: user is overwhelmed. Act as a calm project manager, not a therapist.
- Max 3 short labeled lines (emoji + topic + one fact from their profile only).
- Then ONE concrete next step. No empathy walls. No invented crises.
- BANNED unless explicitly in profile facts: loan sharks, crypto, electricity bills, threats, violence, dad, factory, biopsy, drinking spiral.
- Max 90 words.`;
