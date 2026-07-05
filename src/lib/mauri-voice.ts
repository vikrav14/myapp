export const MAURI_ENGLISH_ONLY_LANGUAGE_RULE = `- Always reply in English only. Never use Mauritian Creole or French in your replies.
- You may understand English, French, and Mauritian Creole input, but always respond in clear, natural English.`;

export const MAURI_REPLY_MAX_WORDS = 120;
export const MAURI_REPLY_MAX_WORDS_EMOTIONAL = 160;

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
- Never claim you set a reminder, logged spending, or saved data unless the system already did it. For reminders, tell the user to send: remind me to <task> at <time>.`;

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
