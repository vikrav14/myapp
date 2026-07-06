import type { UserMindExtraction } from "../schemas/user-mind.js";
import type { UserMindFact } from "../types.js";
import {
  LIFE_THREAD_MAX_ONBOARDING,
  LIFE_THREAD_SCHEDULE_DAYS,
  LIFE_THREAD_STAGGER_DAYS
} from "./life-thread.constants.js";

export type LifeThreadKind = "health_wait" | "family_care" | "crisis" | "generic";

export interface LifeThreadCandidate {
  loopText: string;
  kind: LifeThreadKind;
  priority: number;
  offsetDays: number;
}

const HEALTH_WAIT_PATTERN =
  /\b(waiting on|awaiting|biopsy|scan result|test result|results back|hospital|appointment|diagnosis|fertility)\b/i;
const FAMILY_CARE_PATTERN =
  /\b(mum|mom|dad|father|mother|parent|sister|brother|family|unwell|not great|struggling|ageing|aging)\b/i;
const CRISIS_PATTERN = /\b(so much|burnout|overwhelm|a lot at once|everything at once|heavy right now)\b/i;

const EMOTIONAL_MESSAGE_PATTERN =
  /\b(waiting|results|scared|worried|anxious|biopsy|hospital|unwell|crisis|heavy|so much|burnout|not great)\b/i;

const KIND_PRIORITY: Record<LifeThreadKind, number> = {
  health_wait: 1,
  family_care: 2,
  crisis: 3,
  generic: 4
};

function classifyThreadText(text: string): LifeThreadKind {
  if (HEALTH_WAIT_PATTERN.test(text)) {
    return "health_wait";
  }

  if (FAMILY_CARE_PATTERN.test(text)) {
    return "family_care";
  }

  if (CRISIS_PATTERN.test(text)) {
    return "crisis";
  }

  return "generic";
}

function relationshipLoopText(label: string, note?: string): string {
  const trimmedNote = note?.trim();
  if (!trimmedNote) {
    return label.trim();
  }

  return `${label.trim()} — ${trimmedNote}`;
}

function buildCandidate(loopText: string): LifeThreadCandidate | null {
  const trimmed = loopText.trim();
  if (trimmed.length < 8) {
    return null;
  }

  const kind = classifyThreadText(trimmed);
  if (kind === "generic") {
    return null;
  }

  return {
    loopText: trimmed,
    kind,
    priority: KIND_PRIORITY[kind],
    offsetDays: LIFE_THREAD_SCHEDULE_DAYS[kind]
  };
}

export function buildLifeThreadCandidatesFromExtraction(
  extraction: UserMindExtraction
): LifeThreadCandidate[] {
  const candidates: LifeThreadCandidate[] = [];

  for (const relationship of extraction.relationships ?? []) {
    const candidate = buildCandidate(relationshipLoopText(relationship.label, relationship.note));
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const stressor of extraction.stressors ?? []) {
    const candidate = buildCandidate(stressor);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return dedupeAndRankCandidates(candidates);
}

export function buildLifeThreadCandidatesFromFacts(facts: UserMindFact[]): LifeThreadCandidate[] {
  const candidates: LifeThreadCandidate[] = [];

  for (const fact of facts) {
    if (fact.category !== "relationships" && fact.category !== "stressors") {
      continue;
    }

    const candidate = buildCandidate(fact.fact_value);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return dedupeAndRankCandidates(candidates);
}

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeAndRankCandidates(candidates: LifeThreadCandidate[]): LifeThreadCandidate[] {
  const seen = new Set<string>();
  const unique: LifeThreadCandidate[] = [];

  for (const candidate of candidates) {
    const key = normalizeForDedup(candidate.loopText);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);
  }

  return unique
    .sort((left, right) => left.priority - right.priority || left.loopText.localeCompare(right.loopText))
    .slice(0, LIFE_THREAD_MAX_ONBOARDING)
    .map((candidate, index) => ({
      ...candidate,
      offsetDays: candidate.offsetDays + index * LIFE_THREAD_STAGGER_DAYS
    }));
}

export function isHeavyKnowYouShare(message: string, facts: UserMindFact[]): boolean {
  if (message.trim().length >= 100) {
    return true;
  }

  if (EMOTIONAL_MESSAGE_PATTERN.test(message)) {
    return true;
  }

  return facts.some((fact) => fact.category === "stressors" || fact.category === "relationships");
}

export function buildHeavyShareLanePrompt(name: string): string {
  return `When you're ready: for your morning brief (7am pulse), what's closest — Corporate / Career, Life & Habits, Student Grind, Entrepreneur Mode, or your own mix?

That's just the brief lane — the rest of what you shared stays with me separately. Reply with the name or send 1–5.`;
}

export function buildLifeThreadActivationNote(threads: Array<{ loop_text: string }>): string | null {
  if (threads.length === 0) {
    return null;
  }

  if (threads.length === 1) {
    return `I've got a gentle check-in queued on ${threads[0]!.loop_text} — reply followups off anytime to pause those.`;
  }

  const preview = threads
    .slice(0, 2)
    .map((thread) => thread.loop_text)
    .join("; ");
  return `I've got gentle check-ins queued (${preview}) — reply followups off anytime to pause those.`;
}
