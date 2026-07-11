import type { MauriUser, WhatsAppInteractiveOutbound } from "../types.js";
import { updateUserState } from "./user.service.js";
import {
  buildHelpFocusActivationExplanation,
  buildHelpFocusEnginePrompt,
  buildHelpFocusSourcesReply,
  buildActivationPlaybookReply,
  formatHelpFocusLabel,
  inferHelpFocusFromFacts,
  isHelpFocusInteractiveEchoMessage,
  normalizeHelpFocusKey,
  parseHelpFocusSourcesRequest
} from "./help-focus-inference.service.js";
import { formatStrategyTrackReplyForUser } from "./mauri-memory-view.service.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_CATALOG } from "./help-focus.constants.js";
import { loadUserMindFacts } from "./user-mind.service.js";
import {
  buildHelpFocusActivationInteractive,
  buildHelpFocusPickerInteractive,
  buildPlaybookConfirmInteractive
} from "./whatsapp-interactive.service.js";
import { buildPostActivationPaceOffer, isPaceConfigured } from "./notification-pace.service.js";

export interface HelpFocusCommandResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  user?: MauriUser | undefined;
  sendTextBeforeInteractive?: boolean | undefined;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseHelpFocusCommand(
  message: string
): { type: "show" } | { type: "set"; key: HelpFocusKey } | { type: "confirm" } | { type: "playbook_confirm" } | null {
  const normalized = normalize(message);

  if (normalized === "help focus confirm") {
    return { type: "confirm" };
  }

  if (normalized === "help playbook confirm") {
    return { type: "playbook_confirm" };
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
  return isWithinHelpFocusActivationWindow(user);
}

export function isWithinHelpFocusActivationWindow(user: MauriUser): boolean {
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
  const resumeActivation = shouldResumeHelpFocusActivation(user);

  if (resumeActivation && !lane) {
    return {
      handled: true,
      user,
      reply: buildActivationPlaybookReply({
        firstName: user.first_name,
        primary: user.help_focus_primary,
        secondary: user.help_focus_secondary
      }),
      interactive: buildPlaybookConfirmInteractive({ firstName: user.first_name }),
      sendTextBeforeInteractive: true
    };
  }

  const reply = buildHelpFocusSourcesReply({
    firstName: user.first_name,
    primary: user.help_focus_primary,
    secondary: user.help_focus_secondary,
    lane: lane ?? undefined
  });

  return {
    handled: true,
    user,
    reply: resumeActivation
      ? `${reply.trim()}\n\nTap Looks good when you're ready for pace.`
      : reply,
    interactive: resumeActivation
      ? buildPlaybookConfirmInteractive({ firstName: user.first_name })
      : undefined,
    sendTextBeforeInteractive: resumeActivation
  };
}

async function offerPaceAfterPlaybook(user: MauriUser): Promise<HelpFocusCommandResult> {
  const paceOffer = await buildPostActivationPaceOffer(user, { force: true });

  if (paceOffer?.reply || paceOffer?.interactive) {
    return {
      handled: true,
      user: paceOffer.user ?? user,
      reply: paceOffer.reply,
      interactive: paceOffer.interactive,
      sendTextBeforeInteractive: Boolean(paceOffer.reply?.trim() && paceOffer.interactive)
    };
  }

  const labels =
    user.help_focus_primary && user.help_focus_secondary
      ? `${formatHelpFocusLabel(user.help_focus_primary)} + ${formatHelpFocusLabel(user.help_focus_secondary)}`
      : user.help_focus_primary
        ? formatHelpFocusLabel(user.help_focus_primary)
        : "your setup";

  return {
    handled: true,
    user,
    reply: `All set, ${user.first_name?.trim() || "there"} — ${labels} locked in. Reply my pace to pick how often I check in.`
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

  if (isHelpFocusInteractiveEchoMessage(input.message)) {
    return { handled: true, user: input.user };
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
      reply: [
        `Locked in — I'll lean into ${labels} for advice.`,
        "",
        buildActivationPlaybookReply({
          firstName: input.user.first_name,
          primary: input.user.help_focus_primary,
          secondary: input.user.help_focus_secondary
        })
      ].join("\n"),
      interactive: buildPlaybookConfirmInteractive({ firstName: input.user.first_name }),
      sendTextBeforeInteractive: true
    };
  }

  if (command.type === "playbook_confirm") {
    return offerPaceAfterPlaybook(input.user);
  }

  if (command.type === "set") {
    const updatedUser = await setHelpFocusPrimary(input.user, command.key);
    const label = HELP_FOCUS_CATALOG.find((entry) => entry.key === command.key)?.label ?? command.key;
    const resumeActivation = shouldResumeHelpFocusActivation(updatedUser);

    return {
      handled: true,
      user: updatedUser,
      reply: resumeActivation
        ? `Got it — I'll lean into ${label} when I advise you. Personal stuff still stays out of your 7am brief. Tap Looks good below to lock it in, or Pick lane to browse again.`
        : `Got it — I'll lean into ${label} when I advise you. Personal stuff still stays out of your 7am brief. Reply help focus anytime to switch.`,
      interactive: resumeActivation
        ? buildHelpFocusActivationInteractive({ firstName: updatedUser.first_name })
        : undefined
    };
  }

  return { handled: false };
}

export { inferHelpFocusFromFacts, buildHelpFocusActivationExplanation, buildHelpFocusSourcesReply, buildActivationPlaybookReply, parseHelpFocusSourcesRequest };
