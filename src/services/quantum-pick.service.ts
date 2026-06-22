import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { getQuantumRandomInt } from "./quantum.service.js";

export interface QuantumPickCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

export type QuantumPickCommand =
  | { type: "range"; min: number; max: number }
  | { type: "options"; choices: string[] }
  | { type: "help" };

const COMMAND_PREFIX =
  /^(?:quantum pick|lucky pick|pick for me|mauri pick|quantum luck)(?:\s+(.+))?$/i;

const NATURAL_RANGE_PATTERN =
  /\bpick(?:\s+a)?\s+number(?:\s+between|\s+from)?\s+(\d+)\s*(?:and|to|-)\s*(\d+)\b/i;

const MAX_RANGE_SPAN = 100;
const MAX_OPTIONS = 10;

function normalizeRange(min: number, max: number): { min: number; max: number } | null {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);

  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower < 1) {
    return null;
  }

  if (upper - lower + 1 > MAX_RANGE_SPAN) {
    return null;
  }

  return { min: lower, max: upper };
}

function parseRangeText(text: string): { min: number; max: number } | null {
  const trimmed = text.trim();

  const naturalMatch = trimmed.match(/^a\s+number(?:\s+between|\s+from)?\s+(\d+)\s*(?:and|to|-)\s*(\d+)$/i);
  if (naturalMatch) {
    return normalizeRange(Number(naturalMatch[1]), Number(naturalMatch[2]));
  }

  const betweenMatch = trimmed.match(/^(\d+)\s*(?:and|to|-)\s*(\d+)$/i);
  if (betweenMatch) {
    return normalizeRange(Number(betweenMatch[1]), Number(betweenMatch[2]));
  }

  const spacedMatch = trimmed.match(/^(\d+)\s+(\d+)$/);
  if (spacedMatch) {
    return normalizeRange(Number(spacedMatch[1]), Number(spacedMatch[2]));
  }

  return null;
}

function parseOptionsText(text: string): string[] | null {
  if (!/[,|/]/.test(text)) {
    return null;
  }

  const choices = text
    .split(/[,|/]/)
    .map((choice) => choice.trim())
    .filter(Boolean);

  if (choices.length < 2 || choices.length > MAX_OPTIONS) {
    return null;
  }

  return choices;
}

export function parseQuantumPickCommand(message: string): QuantumPickCommand | null {
  const trimmed = message.trim();
  const prefixMatch = trimmed.match(COMMAND_PREFIX);
  if (prefixMatch) {
    const payload = prefixMatch[1]?.trim();
    if (!payload) {
      return { type: "help" };
    }

    const range = parseRangeText(payload);
    if (range) {
      return { type: "range", ...range };
    }

    const options = parseOptionsText(payload);
    if (options) {
      return { type: "options", choices: options };
    }

    return { type: "help" };
  }

  const naturalRange = trimmed.match(NATURAL_RANGE_PATTERN);
  if (naturalRange) {
    const range = normalizeRange(Number(naturalRange[1]), Number(naturalRange[2]));
    if (range) {
      return { type: "range", ...range };
    }
  }

  return null;
}

function buildQuantumPickHelpReply(): string {
  return `Can't decide? I can pull true randomness from a live quantum lab.

Number pick:
quantum pick 1 5

Option pick:
quantum pick Tribeca, Docker, Nandos

Aliases: lucky pick, pick for me, mauri pick`;
}

function buildQuantumPickReply(input: {
  source: "quantum" | "fallback";
  number?: number | undefined;
  choice?: string | undefined;
  choices?: string[] | undefined;
}): string {
  const opener =
    input.source === "quantum"
      ? "Pulled a true random call from a live quantum lab — not guesswork."
      : "The quantum lab was quiet, so I used backup randomness.";

  if (input.choice && input.choices) {
    return `${opener}

Out of ${input.choices.join(", ")} — the universe says: ${input.choice}.

Go with it.`;
  }

  return `${opener}

The universe says: ${input.number}.

Commit to it.`;
}

export async function handleQuantumPickMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<QuantumPickCommandResult> {
  const command = parseQuantumPickCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first, then you can use quantum pick when you can't decide."
    };
  }

  if (command.type === "help") {
    return {
      handled: true,
      reply: buildQuantumPickHelpReply()
    };
  }

  if (command.type === "range") {
    const random = await getQuantumRandomInt(command.min, command.max);

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "quantum_pick_used",
      userId: input.user.id,
      entityType: "user",
      entityId: input.user.id,
      message: "User requested a quantum number pick.",
      metadata: {
        mode: "range",
        min: command.min,
        max: command.max,
        value: random.value,
        source: random.source
      }
    });

    return {
      handled: true,
      reply: buildQuantumPickReply({
        source: random.source,
        number: random.value
      })
    };
  }

  const random = await getQuantumRandomInt(1, command.choices.length);
  const choice = command.choices[random.value - 1];

  if (!choice) {
    return {
      handled: true,
      reply: buildQuantumPickHelpReply()
    };
  }

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "quantum_pick_used",
    userId: input.user.id,
    entityType: "user",
    entityId: input.user.id,
    message: "User requested a quantum option pick.",
    metadata: {
      mode: "options",
      choices: command.choices,
      value: choice,
      source: random.source
    }
  });

  return {
    handled: true,
    reply: buildQuantumPickReply({
      source: random.source,
      choice,
      choices: command.choices
    })
  };
}
