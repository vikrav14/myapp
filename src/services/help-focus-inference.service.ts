import type { UserMindFact } from "../types.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_BY_KEY, HELP_FOCUS_CATALOG, HELP_FOCUS_KEYS } from "./help-focus.constants.js";

export interface InferredHelpFocus {
  primary: HelpFocusKey;
  secondary: HelpFocusKey | null;
}

const DOMAIN_PATTERNS: Record<HelpFocusKey, RegExp> = {
  productivity: /\b(productivity|focus|deep work|routine|habit|overwhelm|chaos|procrastinat|distract)\b/i,
  personal_finance: /\b(money|finance|afford|rent|loan|debt|broke|saving|salary|payday|runway|tuition|pension)\b/i,
  business: /\b(business|startup|founder|shop owner|retail|entrepreneur|side hustle|client|customer|revenue)\b/i,
  self_help: /\b(lost my way|lost way|confidence|identity|stuck|self esteem|not looking good|feel lost|depressed|anxious)\b/i,
  critical_thinking: /\b(decision|choose|confused about|not sure if|should i|what if|scam|misinformation)\b/i,
  relationship: /\b(partner|wife|husband|girlfriend|boyfriend|marriage|lonely|breakup|family conflict|attachment)\b/i,
  human_behavior: /\b(office politics|boss|coworker|manipul|leverage|power play|toxic colleague)\b/i,
  philosophy: /\b(meaning|purpose|stoic|why am i|what's the point|whats the point|acceptance|grief)\b/i,
  discipline: /\b(discipline|lazy|can't stick|cannot stick|give up|accountability|no motivation|drink|drinking)\b/i,
  communication: /\b(confront|negotiat|raise|boundary|argument|talk to my|tell my boss|difficult conversation)\b/i,
  health: /\b(sleep|exhaust|tired|health|doctor|hospital|dengue|burnout|no energy|sick)\b/i,
  career: /\b(career|job|promotion|interview|cv|resume|painter|developer|employed|unemployed|émigr|emigr|office in)\b/i,
  parenting: /\b(parent|parenting|daughter|son|child|kid|grandchild|granddaughter|grandson|school|tuition|carer)\b/i
};

function factBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
}

export function isHelpFocusKey(value: string): value is HelpFocusKey {
  return (HELP_FOCUS_KEYS as readonly string[]).includes(value);
}

export function normalizeHelpFocusKey(value: string): HelpFocusKey | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");

  if (isHelpFocusKey(normalized)) {
    return normalized;
  }

  const byLabel = HELP_FOCUS_CATALOG.find(
    (entry) => entry.label.toLowerCase() === value.trim().toLowerCase()
  );
  return byLabel?.key ?? null;
}

export function formatHelpFocusLabel(key: HelpFocusKey | null | undefined): string {
  if (!key) {
    return "General";
  }

  return HELP_FOCUS_BY_KEY[key]?.label ?? key;
}

export function inferHelpFocusFromFacts(facts: UserMindFact[]): InferredHelpFocus {
  const scores = Object.fromEntries(HELP_FOCUS_KEYS.map((key) => [key, 0])) as Record<HelpFocusKey, number>;

  for (const fact of facts) {
    const blob = factBlob(fact);
    for (const key of HELP_FOCUS_KEYS) {
      if (DOMAIN_PATTERNS[key].test(blob)) {
        scores[key] += fact.category === "stressors" || fact.category === "goals" ? 2 : 1;
      }
    }
  }

  const combined = facts.map(factBlob).join(" ");
  if (/\b(struggling with money|money pressure|can't afford|cannot afford|broke|financial stress)\b/.test(combined)) {
    scores.personal_finance += 2;
  }

  if (/\b(drink(ing)? a lot|heavy drink|lost my way|lost way)\b/.test(combined)) {
    scores.discipline += 1;
    scores.self_help += 1;
  }

  if (/\b(daughter|son|child|tuition|parent|parenting|grandchild)\b/.test(combined)) {
    scores.parenting += 2;
  }

  const ranked = HELP_FOCUS_KEYS.map((key) => ({ key, score: scores[key] }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const primary = ranked[0]?.key ?? "self_help";
  const secondary = ranked[1]?.key && ranked[1].key !== primary ? ranked[1].key : null;

  return { primary, secondary };
}

export function buildHelpFocusEnginePrompt(input: {
  primary: HelpFocusKey | null | undefined;
  secondary?: HelpFocusKey | null | undefined;
}): string {
  const lines: string[] = [];

  if (input.primary && HELP_FOCUS_BY_KEY[input.primary]) {
    lines.push(`Primary help focus: ${HELP_FOCUS_BY_KEY[input.primary].label}`);
    lines.push(HELP_FOCUS_BY_KEY[input.primary].enginePrompt);
  }

  if (input.secondary && input.secondary !== input.primary && HELP_FOCUS_BY_KEY[input.secondary]) {
    lines.push(`Secondary help focus: ${HELP_FOCUS_BY_KEY[input.secondary].label}`);
    lines.push(HELP_FOCUS_BY_KEY[input.secondary].enginePrompt);
  }

  if (lines.length === 0) {
    return "Help focus: not set yet — infer gently from their message; prioritize empathy and one practical next step.";
  }

  lines.push(
    "Never name-drop books. Synthesize frameworks into ≤60 words of localized advice. Personal stuff stays out of the 7am brief."
  );

  return lines.join("\n");
}

export function buildHelpFocusStatusReply(input: {
  firstName?: string | null;
  primary: HelpFocusKey | null;
  secondary: HelpFocusKey | null;
}): string {
  const name = input.firstName?.trim() || "there";

  if (!input.primary) {
    return `${name} — pick what you want me to help with most. Tap the list below or reply help focus anytime.`;
  }

  if (input.secondary) {
    return `${name} — I'm leaning into ${formatHelpFocusLabel(input.primary)} and ${formatHelpFocusLabel(input.secondary)} for advice. Reply help focus to change.`;
  }

  return `${name} — I'm leaning into ${formatHelpFocusLabel(input.primary)} for advice. Reply help focus to change.`;
}
