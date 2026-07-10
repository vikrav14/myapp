import type { UserMindFact } from "../types.js";
import { formatStrategyTrackBlock } from "./mauri-memory-view.service.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_BY_KEY, HELP_FOCUS_CATALOG, HELP_FOCUS_KEYS } from "./help-focus.constants.js";
import { combinedFactBlob, hasBoundaryGoal, hasFamilyMoneyPressure } from "./profile-inference.service.js";

export interface InferredHelpFocus {
  primary: HelpFocusKey;
  secondary: HelpFocusKey | null;
}

const DOMAIN_PATTERNS: Record<HelpFocusKey, RegExp> = {
  productivity: /\b(productivity|focus|deep work|routine|habit|overwhelm|chaos|procrastinat|distract)\b/i,
  personal_finance: /\b(money|finance|afford|rent|loan|debt|broke|saving|salary|payday|runway|tuition|pension|wedding|bank account|bleeding me dry|flat despite)\b/i,
  business: /\b(business|startup|founder|shop owner|retail|entrepreneur|side hustle|client|customer|revenue)\b/i,
  self_help: /\b(lost my way|lost way|confidence|identity|stuck|self esteem|not looking good|feel lost|depressed|anxious)\b/i,
  critical_thinking: /\b(decision|choose|confused about|not sure if|should i|what if|scam|misinformation)\b/i,
  relationship: /\b(partner|wife|husband|girlfriend|boyfriend|fianc[eé]e|marriage|lonely|breakup|family conflict|family drama|attachment|controlling|overbearing|granddaughter|grandson|grandchild|mum|mother|dad|father)\b/i,
  human_behavior: /\b(office politics|boss|coworker|manipul|leverage|power play|toxic colleague)\b/i,
  philosophy: /\b(meaning|purpose|stoic|why am i|what's the point|whats the point|acceptance|grief)\b/i,
  discipline: /\b(discipline|lazy|can't stick|cannot stick|give up|accountability|no motivation|drink|drinking)\b/i,
  communication: /\b(confront|negotiat|raise|boundar(y|ies)|argument|talk to my|tell my boss|difficult conversation|say no|selfish)\b/i,
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

export function formatHelpFocusUserLens(key: HelpFocusKey | null | undefined): string | null {
  if (!key) {
    return null;
  }

  return HELP_FOCUS_BY_KEY[key]?.userLens ?? null;
}

function pickHelpFocusFactHook(
  facts: UserMindFact[],
  primary: HelpFocusKey,
  secondary: HelpFocusKey | null
): string | null {
  const blob = combinedFactBlob(facts);

  if (primary === "personal_finance" || secondary === "personal_finance") {
    if (hasFamilyMoneyPressure(facts)) {
      return "picked up family money pressure on top of good income";
    }
    if (/\b(bank account.*flat|bleeding me dry|loan|wedding.*cost)\b/.test(blob)) {
      return "picked up money stress from what you shared";
    }
  }

  if (primary === "parenting" || secondary === "parenting") {
    if (/\b(carer|caregiver|special needs|tuition|sandwich)\b/.test(blob)) {
      return "picked up carer and family-load pressure";
    }
  }

  if (primary === "communication" || secondary === "communication") {
    if (/\b(boundar(y|ies)|say no|guilt trip|selfish)\b/.test(blob)) {
      return "picked up you want to hold boundaries without the guilt";
    }
  }

  if (primary === "relationship" || secondary === "relationship") {
    if (/\b(mum|dad|fianc|family drama|guilt)\b/.test(blob)) {
      return "picked up family dynamics weighing on you";
    }
  }

  return null;
}

export function buildHelpFocusActivationExplanation(input: {
  primary: HelpFocusKey | null;
  secondary?: HelpFocusKey | null;
  facts?: UserMindFact[];
}): string | null {
  if (!input.primary) {
    return "Reply help focus anytime to pick what you want advice on.";
  }

  const labels =
    input.secondary && input.secondary !== input.primary
      ? `${formatHelpFocusLabel(input.primary)} + ${formatHelpFocusLabel(input.secondary)}`
      : formatHelpFocusLabel(input.primary);

  const lenses = [formatHelpFocusUserLens(input.primary), input.secondary ? formatHelpFocusUserLens(input.secondary) : null]
    .filter(Boolean)
    .join(" · ");

  const factHook =
    input.facts && input.facts.length > 0
      ? pickHelpFocusFactHook(input.facts, input.primary, input.secondary ?? null)
      : null;

  const whyLine = factHook ? `I ${factHook}.` : "I read that from what you shared.";

  const trackBlock = formatStrategyTrackBlock({
    laneLabels: labels,
    howIHelp: lenses || "One practical next step at a time."
  });

  return [
    `For advice I'll lean into ${labels} — ${whyLine}`,
    "",
    ...trackBlock,
    "",
    "Next message — tap Looks good or Pick lane. Reply help focus anytime to change later."
  ].join("\n");
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

    if (
      fact.category === "goals" &&
      /\b(track.*fund|private.*fund|little fund|track my|safe space.*track)\b/.test(blob)
    ) {
      scores.personal_finance += 4;
    }
  }

  const combined = combinedFactBlob(facts);
  if (/\b(struggling with money|money pressure|can't afford|cannot afford|broke|financial stress)\b/.test(combined)) {
    scores.personal_finance += 2;
  }

  if (hasFamilyMoneyPressure(facts)) {
    scores.personal_finance += 4;
    scores.relationship += 3;
    scores.career = Math.max(0, scores.career - 2);
  }

  if (hasBoundaryGoal(facts)) {
    scores.communication += 4;
    scores.relationship += 1;
  }

  if (/\b(bitter|guilt trip|calls me selfish|emotional manipulation)\b/.test(combined)) {
    scores.relationship += 2;
  }

  if (/\b(private|secret|track.*fund|little fund|pension|tuition)\b/.test(combined)) {
    scores.personal_finance += 2;
  }

  if (/\b(private.*fund|track.*fund|little fund|safe space.*track|track my little)\b/.test(combined)) {
    scores.personal_finance += 3;
  }

  if (/\b(drink(ing)? a lot|heavy drink|lost my way|lost way)\b/.test(combined)) {
    scores.discipline += 1;
    scores.self_help += 1;
  }

  if (/\b(granddaughter|grandson|grandchild|grandma|grandpa|grandmother|grandfather)\b/.test(combined)) {
    scores.relationship += 2;
  }

  if (/\b(family drama|controlling|overbearing|son.*control)\b/.test(combined)) {
    scores.relationship += 2;
  }

  if (
    /\b(daughter|son|child|tuition|parent|parenting)\b/.test(combined) &&
    !/\bgrand(daughter|son|child|ma|pa|mother|father)\b/.test(combined)
  ) {
    scores.parenting += 2;
  }

  const ranked = HELP_FOCUS_KEYS.map((key) => ({ key, score: scores[key] }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  let primary = ranked[0]?.key ?? "self_help";
  let secondary = ranked[1]?.key && ranked[1].key !== primary ? ranked[1].key : null;

  if (hasFamilyMoneyPressure(facts) && scores.personal_finance > 0 && primary !== "personal_finance") {
    secondary = primary;
    primary = "personal_finance";
  }

  if (hasBoundaryGoal(facts) && primary === "personal_finance" && secondary !== "communication" && scores.communication > 0) {
    secondary = "communication";
  }

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
