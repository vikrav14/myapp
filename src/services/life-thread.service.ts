import type { UserMindExtraction } from "../schemas/user-mind.js";
import type { UserMindFact } from "../types.js";
import {
  LIFE_THREAD_MAX_ONBOARDING,
  LIFE_THREAD_SCHEDULE_DAYS,
  LIFE_THREAD_STAGGER_DAYS
} from "./life-thread.constants.js";

export type LifeThreadKind =
  | "health_wait"
  | "family_care"
  | "crisis"
  | "personal_crossroads"
  | "substance"
  | "generic";

export interface LifeThreadCandidate {
  loopText: string;
  kind: LifeThreadKind;
  priority: number;
  offsetDays: number;
}

const HEALTH_WAIT_PATTERN =
  /\b(waiting on|awaiting|biopsy|scan result|test result|results back|hospital|appointment|diagnosis|fertility)\b/i;
const FAMILY_CARE_PATTERN =
  /\b(mum|mom|dad|father|mother|parent|sister|brother|family|family drama|granddaughter|grandson|grandchild|unwell|not great|struggling|ageing|aging|controlling|overbearing)\b/i;
const SUBSTANCE_PATTERN =
  /\b(drink(ing)? a lot|drink too much|drinking too much|heavy drink|too much alcohol|alcohol problem)\b/i;
const CROSSROADS_PATTERN =
  /\b(lost my way|lost way|career change|change career|considering a career|off track|not looking good|feel lost|no direction|don't know what|dont know what)\b/i;
const CRISIS_PATTERN =
  /\b(so much|burnout|overwhelm|a lot at once|everything at once|heavy right now|its not looking good|it's not looking good|not looking good|hopeless|can't cope|cannot cope)\b/i;
const MONEY_PRESSURE_PATTERN =
  /\b(struggling with money|money trouble|can't afford|cannot afford|broke|financial stress|money pressure|no money)\b/i;

const EMOTIONAL_MESSAGE_PATTERN =
  /\b(waiting|results|scared|worried|anxious|biopsy|hospital|unwell|crisis|heavy|so much|burnout|not great|lost|drink|money|career change)\b/i;

const THREAD_FACT_CATEGORIES = new Set(["relationships", "stressors", "goals", "life_context"]);

const KIND_PRIORITY: Record<Exclude<LifeThreadKind, "generic">, number> = {
  health_wait: 1,
  family_care: 2,
  substance: 3,
  personal_crossroads: 4,
  crisis: 5
};

function classifyThreadText(text: string): LifeThreadKind {
  if (HEALTH_WAIT_PATTERN.test(text)) {
    return "health_wait";
  }

  if (FAMILY_CARE_PATTERN.test(text)) {
    return "family_care";
  }

  if (SUBSTANCE_PATTERN.test(text)) {
    return "substance";
  }

  if (CROSSROADS_PATTERN.test(text) || MONEY_PRESSURE_PATTERN.test(text)) {
    return "personal_crossroads";
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

function buildCandidateFromFact(fact: UserMindFact): LifeThreadCandidate | null {
  const loopText = factLoopText(fact);
  if (loopText.length < 8) {
    return null;
  }

  const kind = classifyThreadText(factClassificationBlob(fact));
  if (kind === "generic") {
    return null;
  }

  return {
    loopText,
    kind,
    priority: KIND_PRIORITY[kind],
    offsetDays: LIFE_THREAD_SCHEDULE_DAYS[kind]
  };
}

function factClassificationBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.replace(/\s+/g, " ").trim();
}

function factLoopText(fact: UserMindFact): string {
  return humanizeLifeThreadLoopText(fact.fact_value.replace(/\s+/g, " ").trim()) ?? "";
}

const CLINICAL_LOOP_PATTERN =
  /\b(experiencing|significant|leading to feelings|emotional manipulation from|financial strain and emotional|despite a good income)\b/i;

export function humanizeLifeThreadLoopText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 8) {
    return null;
  }

  if (!CLINICAL_LOOP_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const manipulationMatch = trimmed.match(/emotional manipulation from (mother|mum|mom|dad|father|parent)/i);
  if (manipulationMatch?.[1]) {
    const raw = manipulationMatch[1].toLowerCase();
    const who =
      raw === "mother" || raw === "mom" || raw === "mum"
        ? "Mum"
        : raw === "father" || raw === "dad"
          ? "Dad"
          : "Family";
    return `${who} guilt trips when you push back`;
  }

  if (/financial strain/i.test(trimmed) && /family/i.test(trimmed)) {
    return "Family money pressure despite good income";
  }

  if (trimmed.length > 72) {
    return null;
  }

  return trimmed;
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

  for (const goal of extraction.goals ?? []) {
    const candidate = buildCandidate(goal);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return dedupeAndRankCandidates(candidates);
}

export function buildLifeThreadCandidatesFromFacts(facts: UserMindFact[]): LifeThreadCandidate[] {
  const candidates: LifeThreadCandidate[] = [];

  for (const fact of facts) {
    if (!THREAD_FACT_CATEGORIES.has(fact.category)) {
      continue;
    }

    const candidate = buildCandidateFromFact(fact);
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

export function buildHeavyShareTrustBridge(firstName?: string | null): string {
  const name = firstName?.trim() || "there";

  return `I'm not just logging this and moving on, ${name}.

What you shared stays between us 🔒 — not in your 7am brief, not shared anywhere.

I'll check in gently on the live stuff and nudge you toward what's next for *you* — small steps, no guilt trips.

When you're ready, tap below. One quick step for your morning pulse only — the real work is us getting sharper together over time.`;
}

export function buildLifeThreadActivationNote(threads: Array<{ loop_text: string }>): string | null {
  if (threads.length === 0) {
    return null;
  }

  const previewThreads = threads
    .map((thread) => humanizeLifeThreadLoopText(thread.loop_text) ?? thread.loop_text.trim())
    .filter((text) => text.length >= 8)
    .slice(0, 2);

  if (previewThreads.length === 0) {
    return null;
  }

  if (previewThreads.length === 1) {
    return `I've got a gentle check-in queued on ${previewThreads[0]!} — reply followups off anytime to pause those.`;
  }

  return `I've got gentle check-ins queued (${previewThreads.join("; ")}) — reply followups off anytime to pause those.`;
}
