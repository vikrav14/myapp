const EMOTIONAL_KEYWORDS =
  /\b(stress|stressed|anxious|anxiety|nervous|worried|scared|depressed|sad|overwhelmed|panic|exhausted|burnout|lonely|miserable|hopeless|struggling|cry|crying|vent|can't focus|cant focus|cannot focus|not ready|can't sleep|cant sleep|pas kapav|mo stress|stress la)\b/i;

const LOGGING_SIGNAL =
  /\b(spent|bought|paid|rs\s?\d|remind(?:er)?|todo|studied|gym|workout|anxious|stress|vent|logged?|payday|salary|habit|task|due)\b/i;

const GENERAL_QA_PATTERN =
  /^(what(?:'s| is| are)|how (?:do|does|can|to)|who (?:is|was)|when (?:did|was|is)|why (?:do|does|is)|tell me about|define|explain)\b/i;

export function isEmotionalMessage(message: string): boolean {
  return EMOTIONAL_KEYWORDS.test(message.trim());
}

export function shouldSkipStructuredExtraction(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }

  if (LOGGING_SIGNAL.test(trimmed)) {
    return false;
  }

  if (isEmotionalMessage(trimmed)) {
    return false;
  }

  return GENERAL_QA_PATTERN.test(trimmed);
}
