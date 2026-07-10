export const MAURI_ENGLISH_ONLY_LANGUAGE_RULE = `- Always reply in English only. Never use Mauritian Creole or French in your replies.
- You may understand English, French, and Mauritian Creole input, but always respond in clear, natural English.`;

/** Mauritius dodo — Mauri's signature mark only. Never in routine replies or every paragraph. */
export const MAURI_SIGNATURE_EMOJI = "🦤";

/**
 * High-signal lines only: privacy pledges, how Mauri advises, trust-before-setup.
 * Max 1–2 per conversation beat — if everything gets 🦤, nothing feels special.
 */
/** Plain-language flagship — use in know-you / express preview, not insider jargon at activation. */
export const MAURI_SMART_ADVICE_VALUE_LINE =
  "15 playbooks behind your lane — Atomic Habits, Psychology of Money, and more compressed into one next step. Reply my playbook when you're curious.";

export function mauriSignatureLine(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith(MAURI_SIGNATURE_EMOJI)) {
    return trimmed;
  }

  return `${MAURI_SIGNATURE_EMOJI} ${trimmed}`;
}

export const MAURI_SIGNATURE_AI_RULE = `- Use ${MAURI_SIGNATURE_EMOJI} at most once per reply, and only for a genuine trust or "how I work" moment — never on greetings, tags, or filler.`;

export const MAURI_REPLY_MAX_WORDS = 120;
export const MAURI_REPLY_MAX_WORDS_EMOTIONAL = 160;
export const MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT = 150;
export const MAURI_REPLY_MAX_WORDS_PROACTIVE = 100;
export const MAURI_REPLY_MAX_WORDS_ROAST_HYPE = 100;
export const MAURI_REPLY_MAX_WORDS_MICRO_LESSON = 80;

const EMOTIONAL_MESSAGE_PATTERN =
  /\b(stress|stressed|anxious|anxiety|overwhelm|overwhelmed|tired|exhausted|sad|depressed|panic|worried|struggling|burnout|hopeless|lonely|scared|afraid|crying|breakdown|can't cope|cannot cope)\b/i;

export const MAURI_TEXT_REPLY_GUARDRAILS = `${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- No bullet lists.
- No numbered steps.
- No generic AI filler.
- No "As an AI".
- Keep paragraphs short and punchy.
- Sound like a real peer, not a productivity bot.
- Hard limit: ${MAURI_REPLY_MAX_WORDS} words (${MAURI_REPLY_MAX_WORDS_EMOTIONAL} if they shared stress). Max 2 short paragraphs.
- Never claim you set a reminder, logged spending, or saved data unless the system already did it. For reminders, tell the user to send: remind me to <task> at <time>.
- Never invent facts about the user's job, hours, family, health, money, or situation. Only reference details explicitly listed in their profile facts or recent logs. If unsure, ask one short question instead of guessing.`;

export function isEmotionalMessage(message: string): boolean {
  return EMOTIONAL_MESSAGE_PATTERN.test(message);
}

export function clampMauriReplyLength(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return trimmed;
  }

  let candidate = words.slice(0, maxWords).join(" ");
  let lastBreak = -1;

  for (const marker of [".", "!", "?"]) {
    const index = candidate.lastIndexOf(marker);
    if (index > lastBreak) {
      lastBreak = index;
    }
  }

  if (lastBreak >= Math.floor(candidate.length * 0.4)) {
    return candidate.slice(0, lastBreak + 1).trim();
  }

  return `${candidate.trim()}…`;
}

export function finalizeMauriTextReply(input: { message: string; reply: string }): string {
  const maxWords = isEmotionalMessage(input.message)
    ? MAURI_REPLY_MAX_WORDS_EMOTIONAL
    : MAURI_REPLY_MAX_WORDS;

  return clampMauriReplyLength(input.reply, maxWords);
}

export function finalizeMauriGeneratedReply(input: {
  reply: string;
  message?: string | undefined;
  maxWords?: number | undefined;
}): string {
  const maxWords =
    input.maxWords ??
    (input.message && isEmotionalMessage(input.message)
      ? MAURI_REPLY_MAX_WORDS_EMOTIONAL
      : MAURI_REPLY_MAX_WORDS);

  return clampMauriReplyLength(input.reply, maxWords);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const OUTBOUND_PAIR_DELAY_MS = 1200;
