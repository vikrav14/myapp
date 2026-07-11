import {
  MAURI_SIGNATURE_EMOJI,
  isEmotionalMessage,
  mauriSignatureLine
} from "./mauri-voice.js";
import { HELP_FOCUS_PLAYBOOK } from "../services/help-focus-playbook.js";
import type { HelpFocusKey } from "../services/help-focus.constants.js";
import type { FinanceExtraction, MauriBrainDumpExtraction, MauriUser } from "../types.js";
import type { ProfileDelta } from "../schemas/message-router.js";

const ADVICE_SEEKING_PATTERN =
  /\b(what should i|should i|how do i|how can i|any (tips|advice)|help me|what would you|what do you think|what's the move|whats the move|next step|what now|am i wrong|did i mess up)\b/i;

const SUBSTANTIVE_COMPLAINT_PATTERN =
  /\b(boss|rent|payday|afford|mum|mom|dad|in[- ]?laws?|partner|wife|husband|always|keeps?|sick of|tired of|unfair|annoying|pressure|fighting|argu|can't cope|cannot cope|hate that|pissed|frustrat|exhausted|overwhelmed|burnout|stuck|lost my way|behind on|owe|debt|fired|quit|cheat|betray|lonely|ghosted|ignored)\b/i;

const LIGHT_VENT_PATTERN = /\b(rough day|bad day|meh|not great|long day)\b/i;

export const MAURI_ADVICE_DODO_RULE = `- When you give playbook-based advice or apply a book lens, open with ${MAURI_SIGNATURE_EMOJI} once — it marks a strategic move, not filler.
- Never stack multiple ${MAURI_SIGNATURE_EMOJI} in one reply.`;

export const MAURI_MEASURABLE_ACK_DODO_RULE = `- When their message produced a reportable log (money spend, income, fixed cost, habit, mood score, or todo), open with one short ${MAURI_SIGNATURE_EMOJI} acknowledgment of what was captured — e.g. "${MAURI_SIGNATURE_EMOJI} Got it — Rs 200 on groceries logged." or "${MAURI_SIGNATURE_EMOJI} Got it — Rs 25,000 income logged." Keep it under 12 words before any advice.`;

export const STRATEGIC_TRANSPARENCY_TACTICAL_RULES = `Strategic transparency (tactical advice — when they want a move or direction):
1. The Action — one suggested move, framed as a hypothesis.
2. The Why — name the playbook source and one plain-English principle (not a long quote).
3. The Opt-In — end with a low-friction question ("Does this feel doable?", "Are we aligned?", "Or is there a bigger fire first?").
Never issue demands. Advice is a strategic hypothesis seeking validation.`;

export const PLAYBOOK_LENS_VENT_RULES = `Playbook lens (when they are complaining, venting, or sharing what's going wrong):
1. Mirror — one short line that shows you heard their situation (required before any framework).
2. One principle — pick the best-matching item from their playbook catalog; name the source book and the idea in plain English.
3. Applied hypothesis — "Based on that, I wonder if…" or "I think we can apply this…" tied to their words.
4. The Opt-In — one open question to validate or redirect.
Skip the book lens on pure lightweight vents ("rough day") — mirror and opt-in only. On chaos or crisis grief, care first; framework only if they steer toward "what do I do?"`;

export function extractionHasReportableData(extraction: MauriBrainDumpExtraction): boolean {
  return Boolean(
    extraction.finance ||
      extraction.habits ||
      extraction.emotions ||
      (extraction.todos && extraction.todos.length > 0)
  );
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

type FinanceCaptureKind = "expense" | "income" | "fixed_cost";

function formatRsAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(0);
}

export function classifyFinanceCapture(finance: FinanceExtraction): FinanceCaptureKind {
  const blob = `${finance.category} ${finance.raw_source_text} ${(finance.context_tags ?? []).join(" ")}`.toLowerCase();

  if (/\b(income|salary|take[- ]?home|paycheque|paycheck|wage|earn|earning|paid me|monthly pay)\b/.test(blob)) {
    return "income";
  }

  if (
    /\b(rent|fixed cost|fixed expense|monthly bill|standing order|mortgage|loan payment|utilities|insurance)\b/.test(
      blob
    ) ||
    finance.context_tags?.some((tag) => /\b(fixed|rent|bill)\b/i.test(tag))
  ) {
    return "fixed_cost";
  }

  return "expense";
}

export function buildFinanceCaptureFragment(finance: FinanceExtraction): string {
  const amount = formatRsAmount(finance.amount);
  const kind = classifyFinanceCapture(finance);

  if (kind === "income") {
    return `Rs ${amount} income logged`;
  }

  if (kind === "fixed_cost") {
    return `Rs ${amount} fixed cost (${finance.category}) logged`;
  }

  return `Rs ${amount} on ${finance.category} logged`;
}

export function buildMeasurableCaptureFragment(extraction: MauriBrainDumpExtraction | undefined): string | null {
  if (!extraction) {
    return null;
  }

  if (extraction.finance) {
    return buildFinanceCaptureFragment(extraction.finance);
  }

  if (extraction.habits) {
    const activity = extraction.habits.activity_type.trim();
    return extraction.habits.is_success ? `${activity} logged` : `${activity} didn't land today`;
  }

  if (extraction.emotions) {
    return `mood ${extraction.emotions.anxiety_score}/5 logged`;
  }

  if (extraction.todos?.length) {
    const count = extraction.todos.length;
    return count === 1 ? "added to your list" : `${count} tasks on your list`;
  }

  return null;
}

export function buildProfileCaptureFragment(deltas: ProfileDelta[] | undefined): string | null {
  if (!deltas?.length) {
    return null;
  }

  const material = deltas.filter((delta) => MATERIAL_PROFILE_CATEGORIES.has(delta.category));
  if (material.length === 0) {
    return null;
  }

  const categories = new Set(material.map((delta) => delta.category));

  if (categories.has("stressors") || categories.has("relationships")) {
    return "updated how I read your money pressure";
  }

  if (categories.has("goals") || categories.has("life_context") || categories.has("interests")) {
    return "updated what you're working toward";
  }

  if (categories.has("location")) {
    return "updated where you're based";
  }

  if (categories.has("boundaries")) {
    return "updated your boundaries";
  }

  return "updated what I know about you";
}

export function buildUnifiedCaptureAck(input: {
  extraction?: MauriBrainDumpExtraction | undefined;
  profileDeltas?: ProfileDelta[] | undefined;
}): string | null {
  const measurable = buildMeasurableCaptureFragment(input.extraction);
  const profile = buildProfileCaptureFragment(input.profileDeltas);

  if (measurable && profile) {
    return `${MAURI_SIGNATURE_EMOJI} Got it — ${measurable}, and ${profile}.`;
  }

  if (measurable) {
    if (input.extraction?.habits && !input.extraction.finance && !input.extraction.emotions) {
      return input.extraction.habits.is_success
        ? `${MAURI_SIGNATURE_EMOJI} Nice — ${measurable}.`
        : `${MAURI_SIGNATURE_EMOJI} Noted — ${measurable}.`;
    }

    if (input.extraction?.todos?.length && !input.extraction.finance && !input.extraction.habits && !input.extraction.emotions) {
      return `${MAURI_SIGNATURE_EMOJI} Noted — ${measurable}.`;
    }

    return `${MAURI_SIGNATURE_EMOJI} Got it — ${measurable}.`;
  }

  if (profile) {
    return `${MAURI_SIGNATURE_EMOJI} Got it — ${profile}.`;
  }

  return null;
}

export function buildRememberFactAck(text: string): string {
  const sanitized = text.trim().replace(/\s+/g, " ");
  const short = sanitized.length > 48 ? `${sanitized.slice(0, 45)}...` : sanitized;
  return `${MAURI_SIGNATURE_EMOJI} Got it — saved for your profile: ${short}.`;
}

function replyAlreadyHasCaptureAck(reply: string): boolean {
  return reply.includes(MAURI_SIGNATURE_EMOJI) && /\b(logged|noted|got it|mood \d|saved|updated)\b/i.test(reply);
}

export function applyCaptureAckToReply(
  reply: string,
  input: {
    extraction?: MauriBrainDumpExtraction | undefined;
    profileDeltas?: ProfileDelta[] | undefined;
  }
): string {
  const ack = buildUnifiedCaptureAck(input);
  if (!ack) {
    return reply.trim();
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    return ack;
  }

  if (replyAlreadyHasCaptureAck(trimmed)) {
    return trimmed;
  }

  return `${ack}\n\n${trimmed}`;
}

export function buildMeasurableLogAckLine(extraction: MauriBrainDumpExtraction): string | null {
  return buildUnifiedCaptureAck({ extraction });
}

export function isAdviceSeekingMessage(message: string): boolean {
  return ADVICE_SEEKING_PATTERN.test(message) || message.trim().endsWith("?");
}

export function isSubstantiveComplaint(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 12) {
    return false;
  }

  if (LIGHT_VENT_PATTERN.test(trimmed) && !SUBSTANTIVE_COMPLAINT_PATTERN.test(trimmed)) {
    return false;
  }

  return isEmotionalMessage(trimmed) || SUBSTANTIVE_COMPLAINT_PATTERN.test(trimmed);
}

export function buildPlaybookCatalogPrompt(input: {
  primary: HelpFocusKey | null | undefined;
  secondary?: HelpFocusKey | null | undefined;
}): string {
  const lanes: HelpFocusKey[] = [];

  if (input.primary) {
    lanes.push(input.primary);
  }
  if (input.secondary && input.secondary !== input.primary) {
    lanes.push(input.secondary);
  }

  if (lanes.length === 0) {
    return "";
  }

  const sections = lanes.map((key, index) => {
    const playbook = HELP_FOCUS_PLAYBOOK[key];
    const role = lanes.length > 1 ? (index === 0 ? " (primary)" : " (secondary)") : "";
    const items = playbook.items
      .map((item) => `  - ${item.outcome} — source: ${item.source}`)
      .join("\n");

    return `${key.replace(/_/g, " ")}${role}:\n${items}`;
  });

  return `Playbook catalog (pick ONE best-matching principle per reply):\n${sections.join("\n\n")}`;
}

export type StrategicTransparencyMode = "tactical" | "lens" | "none";

export function resolveStrategicTransparencyMode(input: {
  message: string;
  hasPlaybookLane: boolean;
  chaosMode: boolean;
  extraction?: MauriBrainDumpExtraction | undefined;
}): StrategicTransparencyMode {
  if (input.chaosMode || !input.hasPlaybookLane) {
    return "none";
  }

  const measurableOnly =
    input.extraction &&
    extractionHasReportableData(input.extraction) &&
    !isSubstantiveComplaint(input.message) &&
    !isAdviceSeekingMessage(input.message) &&
    !isEmotionalMessage(input.message);

  if (measurableOnly) {
    return "none";
  }

  if (isAdviceSeekingMessage(input.message)) {
    return "tactical";
  }

  if (isSubstantiveComplaint(input.message)) {
    return "lens";
  }

  if (isEmotionalMessage(input.message)) {
    return "lens";
  }

  return "tactical";
}

export function buildStrategicTransparencyPromptBlock(input: {
  user: MauriUser;
  message: string;
  chaosMode: boolean;
  extraction?: MauriBrainDumpExtraction | undefined;
}): { block: string; mode: StrategicTransparencyMode } {
  const hasPlaybookLane = Boolean(input.user.help_focus_primary);
  const mode = resolveStrategicTransparencyMode({
    message: input.message,
    hasPlaybookLane,
    chaosMode: input.chaosMode,
    extraction: input.extraction
  });

  if (mode === "none") {
    return { block: "", mode };
  }

  const catalog = buildPlaybookCatalogPrompt({
    primary: input.user.help_focus_primary,
    secondary: input.user.help_focus_secondary
  });

  const modeRules = mode === "lens" ? PLAYBOOK_LENS_VENT_RULES : STRATEGIC_TRANSPARENCY_TACTICAL_RULES;

  return {
    mode,
    block: [
      modeRules,
      catalog,
      MAURI_ADVICE_DODO_RULE,
      "Name the book source when the framework is doing work. Personal stuff stays out of the 7am brief."
    ].join("\n\n")
  };
}

export function prependMeasurableAckIfMissing(
  reply: string,
  extraction: MauriBrainDumpExtraction,
  profileDeltas?: ProfileDelta[] | undefined
): string {
  return applyCaptureAckToReply(reply, { extraction, profileDeltas });
}

export function ensureMauriDodoOnAdviceReply(reply: string, shouldApply: boolean): string {
  if (!shouldApply) {
    return reply.trim();
  }

  const trimmed = reply.trim();
  if (!trimmed || trimmed.includes(MAURI_SIGNATURE_EMOJI)) {
    return trimmed;
  }

  return mauriSignatureLine(trimmed);
}
