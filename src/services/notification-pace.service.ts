import type { MauriUser, WhatsAppInteractiveOutbound } from "../types.js";
import type { NotificationConfig, ProactivePacePreset } from "./notification-pace.constants.js";
import {
  DEFAULT_PROACTIVE_PACE_PRESET,
  DENSITY_MAX_WORDS,
  PACE_PRESET_CATALOG,
  type PacePresetDefinition
} from "./notification-pace.constants.js";
import { updateUserState } from "./user.service.js";
import { countProactivePingsToday, formatQuietHoursWindow } from "./outbound-pace.service.js";
import { buildPacePickerInteractive } from "./whatsapp-interactive.service.js";

export interface PaceCommandResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  user?: MauriUser | undefined;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeNotificationConfig(value: unknown): NotificationConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const preset = value.proactive_preset;
  if (typeof preset !== "string" || !PACE_PRESET_CATALOG.some((entry) => entry.key === preset)) {
    return null;
  }

  const definition = getPacePresetDefinition(preset as ProactivePacePreset);
  if (!definition) {
    return null;
  }

  const configuredAt =
    typeof value.configured_at === "string" && value.configured_at.trim() ? value.configured_at : undefined;

  return {
    proactive_preset: definition.key,
    density_profile: definition.density_profile,
    proactive_max_per_day: definition.proactive_max_per_day,
    proactive_min_interval_minutes: definition.proactive_min_interval_minutes,
    proactive_max_per_week: definition.proactive_max_per_week,
    configured_at: configuredAt
  };
}

export function getPacePresetDefinition(preset: ProactivePacePreset): PacePresetDefinition | null {
  return PACE_PRESET_CATALOG.find((entry) => entry.key === preset) ?? null;
}

export function resolveNotificationConfig(user: MauriUser): NotificationConfig {
  const stored = sanitizeNotificationConfig(user.notification_config);
  if (stored) {
    return stored;
  }

  const definition = getPacePresetDefinition(DEFAULT_PROACTIVE_PACE_PRESET)!;
  return {
    proactive_preset: definition.key,
    density_profile: definition.density_profile,
    proactive_max_per_day: definition.proactive_max_per_day,
    proactive_min_interval_minutes: definition.proactive_min_interval_minutes,
    proactive_max_per_week: definition.proactive_max_per_week
  };
}

export function isPaceConfigured(user: MauriUser): boolean {
  const stored = sanitizeNotificationConfig(user.notification_config);
  return Boolean(stored?.configured_at);
}

export function formatPacePresetLabel(preset: ProactivePacePreset): string {
  return getPacePresetDefinition(preset)?.label ?? preset;
}

export function parsePacePreset(value: string): ProactivePacePreset | null {
  const normalized = normalize(value).replace(/^pace\s+/, "");
  const byKey = PACE_PRESET_CATALOG.find((entry) => entry.key === normalized);
  if (byKey) {
    return byKey.key;
  }

  const byLabel = PACE_PRESET_CATALOG.find((entry) => entry.label.toLowerCase() === normalized);
  return byLabel?.key ?? null;
}

export function parsePaceCommand(message: string): { type: "show" } | { type: "set"; preset: ProactivePacePreset } | null {
  const normalized = normalize(message);

  if (
    normalized === "my pace" ||
    normalized === "change pace" ||
    normalized === "pace" ||
    normalized === "my rhythm" ||
    normalized === "change rhythm" ||
    normalized === "check in pace" ||
    normalized === "checkin pace"
  ) {
    return { type: "show" };
  }

  const explicit = normalized.match(/^pace (silent|bookends|steady|engaged|coaching)$/);
  if (explicit?.[1]) {
    return { type: "set", preset: explicit[1] as ProactivePacePreset };
  }

  return null;
}

export function buildPaceStatusReply(user: MauriUser, sentToday: number): string {
  const config = resolveNotificationConfig(user);
  const preset = getPacePresetDefinition(config.proactive_preset);
  const lines = [
    "Your Mauri pace",
    "",
    `Unprompted check-ins: ${preset?.label ?? config.proactive_preset}`,
    preset?.description ?? "",
    `Density: ${config.density_profile}`,
    `Today: ${sentToday}/${config.proactive_max_per_day} unprompted pings used`,
    `Quiet hours: ${user.quiet_hours_enabled ? "on" : "off"}${user.quiet_hours_enabled ? ` (${formatQuietHoursWindow(user)})` : ""}`,
    "",
    "7am brief and replies when you message are separate.",
    "Reply my pace anytime to change, or not now to pause 7 days."
  ];

  return lines.filter((line, index) => line.length > 0 || index === 0).join("\n");
}

export function buildPaceSelectionReply(user: MauriUser, preset: ProactivePacePreset): string {
  const definition = getPacePresetDefinition(preset);
  const name = user.first_name?.trim() || "there";
  if (!definition) {
    return `Got it, ${name} — pace updated.`;
  }

  if (preset === "silent") {
    return `Got it, ${name} — I won't ping unprompted. Message me anytime; your 7am brief still runs unless you say digest off.`;
  }

  if (preset === "coaching") {
    return `Coaching mode on, ${name} — up to ${definition.proactive_max_per_day} short pings/day in active hours. Reply my pace or not now anytime to dial back.`;
  }

  return `Set, ${name} — ${definition.label.toLowerCase()} (${definition.proactive_max_per_day} unprompted pings/day max). Reply my pace anytime to switch.`;
}

export async function setUserPacePreset(user: MauriUser, preset: ProactivePacePreset): Promise<MauriUser> {
  const definition = getPacePresetDefinition(preset);
  if (!definition) {
    return user;
  }

  const notification_config: NotificationConfig = {
    proactive_preset: definition.key,
    density_profile: definition.density_profile,
    proactive_max_per_day: definition.proactive_max_per_day,
    proactive_min_interval_minutes: definition.proactive_min_interval_minutes,
    proactive_max_per_week: definition.proactive_max_per_week,
    configured_at: new Date().toISOString()
  };

  return updateUserState(user.id, { notification_config });
}

export function buildPostActivationPacePrompt(firstName?: string | null): string {
  const name = firstName?.trim() || "there";
  return `Last beat, ${name} — how often should I check in unprompted?`;
}

export function getProactiveMaxWords(user: MauriUser): number {
  return DENSITY_MAX_WORDS[resolveNotificationConfig(user).density_profile];
}

export function getDensityPromptBlock(user: MauriUser): string {
  const profile = resolveNotificationConfig(user).density_profile;

  if (profile === "micro") {
    return `- Density: micro. One tactical move only. No theory, no greeting, no recap. Max ${DENSITY_MAX_WORDS.micro} words.`;
  }

  if (profile === "depth") {
    return `- Density: depth. Ground them, one reframe, one next step. Max ${DENSITY_MAX_WORDS.depth} words in 2 short paragraphs. No book names unless they asked.`;
  }

  return `- Density: pulse. Progress check + one nudge. Max ${DENSITY_MAX_WORDS.pulse} words. Two short lines max — no bullet lists.`;
}

export async function handlePaceMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<PaceCommandResult> {
  const command = parsePaceCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first — then reply my pace to set how often I check in unprompted."
    };
  }

  if (command.type === "show") {
    const sentToday = await countProactivePingsToday(input.user.id);
    return {
      handled: true,
      user: input.user,
      reply: buildPaceStatusReply(input.user, sentToday),
      interactive: buildPacePickerInteractive({
        firstName: input.user.first_name,
        suggestedPreset: resolveNotificationConfig(input.user).proactive_preset
      })
    };
  }

  const updatedUser = await setUserPacePreset(input.user, command.preset);
  return {
    handled: true,
    user: updatedUser,
    reply: buildPaceSelectionReply(updatedUser, command.preset)
  };
}

export async function buildPostActivationPaceOffer(user: MauriUser): Promise<PaceCommandResult | null> {
  if (isPaceConfigured(user)) {
    return null;
  }

  return {
    handled: true,
    user,
    reply: buildPostActivationPacePrompt(user.first_name),
    interactive: buildPacePickerInteractive({
      firstName: user.first_name,
      suggestedPreset: DEFAULT_PROACTIVE_PACE_PRESET
    })
  };
}
