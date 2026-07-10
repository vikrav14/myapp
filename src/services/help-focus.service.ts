import type { MauriUser, WhatsAppInteractiveOutbound } from "../types.js";
import { updateUserState } from "./user.service.js";
import {
  buildHelpFocusActivationExplanation,
  buildHelpFocusEnginePrompt,
  buildHelpFocusSourcesReply,
  formatHelpFocusLabel,
  inferHelpFocusFromFacts,
  normalizeHelpFocusKey,
  parseHelpFocusSourcesRequest
} from "./help-focus-inference.service.js";
import { formatStrategyTrackReplyForUser } from "./mauri-memory-view.service.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_CATALOG } from "./help-focus.constants.js";
import { loadUserMindFacts } from "./user-mind.service.js";
import {
  buildHelpFocusActivationInteractive,
  buildHelpFocusPickerInteractive
} from "./whatsapp-interactive.service.js";

export interface HelpFocusCommandResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  user?: MauriUser | undefined;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseHelpFocusCommand(
  message: string
): { type: "show" } | { type: "set"; key: HelpFocusKey } | { type: "confirm" } | null {
  const normalized = normalize(message);

  if (normalized === "help focus confirm") {
    return { type: "confirm" };
  }

  if (
    normalized === "help focus" ||
    normalized === "my help focus" ||
    normalized === "change help focus" ||
    normalized === "advice focus" ||
    normalized === "change your advice lane" ||
    normalized === "switch advice lane" ||
    normalized === "pick advice lane"
  ) {
    return { type: "show" };
  }

  if (/\b(change|switch|pick)\b/.test(normalized) && /\b(advice|help)\b/.test(normalized) && /\b(focus|lane)\b/.test(normalized)) {
    return { type: "show" };
  }

  const domainMatch = normalized.match(/^help domain (.+)$/);
  if (domainMatch?.[1]) {
    const key = normalizeHelpFocusKey(domainMatch[1]);
    if (key) {
      return { type: "set", key };
    }
  }

  const setMatch = normalized.match(/^help focus (.+)$/);
  if (setMatch?.[1]) {
    if (setMatch[1] === "sources") {
      return null;
    }

    const key = normalizeHelpFocusKey(setMatch[1]);
    if (key) {
      return { type: "set", key };
    }
  }

  return null;
}

function shouldResumeHelpFocusActivation(user: MauriUser): boolean {
  if (!user.onboarding_completed_at) {
    return false;
  }

  const completedAt = new Date(user.onboarding_completed_at).getTime();
  if (Number.isNaN(completedAt)) {
    return false;
  }

  const activationWindowMs = 6 * 60 * 60 * 1000;
  return Date.now() - completedAt < activationWindowMs;
}

function buildPlaybookHelpFocusResult(
  user: MauriUser,
  lane?: HelpFocusKey | null
): HelpFocusCommandResult {
  const reply = buildHelpFocusSourcesReply({
    firstName: user.first_name,
    primary: user.help_focus_primary,
    secondary: user.help_focus_secondary,
    lane: lane ?? undefined
  });

  const resumeActivation = shouldResumeHelpFocusActivation(user);

  return {
    handled: true,
    user,
    reply: resumeActivation
      ? `${reply.trim()}\n\nTap Looks good to lock this lane, or Pick lane to switch.`
      : reply,
    interactive: resumeActivation
      ? buildHelpFocusActivationInteractive({ firstName: user.first_name })
      : undefined
  };
}

export async function assignHelpFocusFromFacts(user: MauriUser): Promise<MauriUser> {
  const facts = await loadUserMindFacts(user.id);
  const inferred = inferHelpFocusFromFacts(facts);

  return updateUserState(user.id, {
    help_focus_primary: inferred.primary,
    help_focus_secondary: inferred.secondary
  });
}

export async function setHelpFocusPrimary(user: MauriUser, key: HelpFocusKey): Promise<MauriUser> {
  return updateUserState(user.id, {
    help_focus_primary: key
  });
}

export function buildHelpFocusPromptForUser(user: MauriUser): string {
  return buildHelpFocusEnginePrompt({
    primary: user.help_focus_primary,
    secondary: user.help_focus_secondary
  });
}

export async function handleHelpFocusMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<HelpFocusCommandResult> {
  if (input.user.onboarding_state !== "active") {
    return { handled: false };
  }

  const sourcesRequest = parseHelpFocusSourcesRequest(input.message);
  if (sourcesRequest) {
    if (sourcesRequest.invalidLane) {
      return {
        handled: true,
        user: input.user,
        reply: `Didn't recognise "${sourcesRequest.invalidLane}". Try my playbook personal finance — or reply help focus to see lanes.`
      };
    }

    if (sourcesRequest.lane) {
      return buildPlaybookHelpFocusResult(input.user, sourcesRequest.lane);
    }

    return buildPlaybookHelpFocusResult(input.user);
  }

  const command = parseHelpFocusCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (command.type === "show") {
    return {
      handled: true,
      user: input.user,
      reply: formatStrategyTrackReplyForUser(input.user),
      interactive: buildHelpFocusPickerInteractive({
        firstName: input.user.first_name,
        suggestedPrimary: input.user.help_focus_primary,
        suggestedSecondary: input.user.help_focus_secondary,
        variant: "status"
      })
    };
  }

  if (command.type === "confirm") {
    const labels =
      input.user.help_focus_primary && input.user.help_focus_secondary
        ? `${formatHelpFocusLabel(input.user.help_focus_primary)} + ${formatHelpFocusLabel(input.user.help_focus_secondary)}`
        : input.user.help_focus_primary
          ? formatHelpFocusLabel(input.user.help_focus_primary)
          : "your setup";

    return {
      handled: true,
      user: input.user,
      reply: `Locked in — I'll lean into ${labels} for advice. Reply help focus anytime to switch.`
    };
  }

  if (command.type === "set") {
    const updatedUser = await setHelpFocusPrimary(input.user, command.key);
    const label = HELP_FOCUS_CATALOG.find((entry) => entry.key === command.key)?.label ?? command.key;

    return {
      handled: true,
      user: updatedUser,
      reply: `Got it — I'll lean into ${label} when I advise you. Personal stuff still stays out of your 7am brief. Reply help focus anytime to switch.`,
      interactive: buildHelpFocusPickerInteractive({
        firstName: updatedUser.first_name,
        suggestedPrimary: updatedUser.help_focus_primary,
        suggestedSecondary: updatedUser.help_focus_secondary
      })
    };
  }

  return { handled: false };
}

export { inferHelpFocusFromFacts, buildHelpFocusActivationExplanation, buildHelpFocusSourcesReply, parseHelpFocusSourcesRequest };
