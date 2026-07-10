import { supabase } from "../lib/supabase.js";
import type { MauriModuleKey, MauriUser, MorningBriefTopicKey, HelpFocusKey, NotificationConfig } from "../types.js";
import { MAURI_MODULE_KEYS, MAX_ACTIVE_MODULES } from "./user-modules.constants.js";
import { isHelpFocusKey } from "./help-focus-inference.service.js";
import type { ProactivePacePreset } from "./notification-pace.constants.js";
import { PACE_PRESET_CATALOG } from "./notification-pace.constants.js";

function sanitizeUserModules(value: unknown): MauriModuleKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique: MauriModuleKey[] = [];
  for (const item of value) {
    const key = String(item).trim().toLowerCase();
    if (!(MAURI_MODULE_KEYS as readonly string[]).includes(key) || unique.includes(key as MauriModuleKey)) {
      continue;
    }

    unique.push(key as MauriModuleKey);
    if (unique.length >= MAX_ACTIVE_MODULES) {
      break;
    }
  }

  return unique;
}

function sanitizeHelpFocus(value: unknown): HelpFocusKey | null {
  if (typeof value !== "string") {
    return null;
  }

  return isHelpFocusKey(value) ? value : null;
}

function sanitizeNotificationConfig(value: unknown): NotificationConfig | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const preset = record.proactive_preset;
  if (typeof preset !== "string" || !PACE_PRESET_CATALOG.some((entry) => entry.key === preset)) {
    return null;
  }

  const definition = PACE_PRESET_CATALOG.find((entry) => entry.key === preset);
  if (!definition) {
    return null;
  }

  return {
    proactive_preset: preset as ProactivePacePreset,
    density_profile: definition.density_profile,
    proactive_max_per_day: definition.proactive_max_per_day,
    proactive_min_interval_minutes: definition.proactive_min_interval_minutes,
    proactive_max_per_week: definition.proactive_max_per_week,
    configured_at:
      typeof record.configured_at === "string" && record.configured_at.trim() ? record.configured_at : undefined
  };
}

export function mapUser(record: Record<string, unknown>): MauriUser {
  return {
    id: String(record.id),
    phone_number: String(record.phone_number),
    first_name: record.first_name ? String(record.first_name) : null,
    archetype: String(record.archetype ?? "Life & Habit Tracking"),
    brief_focus: record.brief_focus ? String(record.brief_focus) : null,
    active_modules: sanitizeUserModules(record.active_modules),
    help_focus_primary: sanitizeHelpFocus(record.help_focus_primary),
    help_focus_secondary: sanitizeHelpFocus(record.help_focus_secondary),
    onboarding_state: (record.onboarding_state ?? "active") as MauriUser["onboarding_state"],
    subscription_status: (record.subscription_status ?? "Trial_Active") as MauriUser["subscription_status"],
    onboarding_completed_at: record.onboarding_completed_at ? String(record.onboarding_completed_at) : null,
    trial_started_at: record.trial_started_at ? String(record.trial_started_at) : null,
    trial_ends_at: record.trial_ends_at ? String(record.trial_ends_at) : null,
    locked_at: record.locked_at ? String(record.locked_at) : null,
    subscription_started_at: record.subscription_started_at ? String(record.subscription_started_at) : null,
    subscription_ends_at: record.subscription_ends_at ? String(record.subscription_ends_at) : null,
    last_payment_at: record.last_payment_at ? String(record.last_payment_at) : null,
    topic_preferences: Array.isArray(record.topic_preferences)
      ? record.topic_preferences.map(String).filter((topic): topic is MorningBriefTopicKey =>
          ["Traffic", "Tech", "Money", "LocalBuzz", "Entertainment"].includes(topic)
        )
      : [],
    morning_digest_enabled: record.morning_digest_enabled !== false,
    calendar_sync_enabled: record.calendar_sync_enabled !== false,
    memory_resurfacing_enabled: record.memory_resurfacing_enabled !== false,
    local_alerts_enabled: record.local_alerts_enabled !== false,
    school_alerts_enabled: record.school_alerts_enabled !== false,
    payday_day_of_month:
      record.payday_day_of_month === null || record.payday_day_of_month === undefined
        ? null
        : Number(record.payday_day_of_month),
    monthly_income_rs:
      record.monthly_income_rs === null || record.monthly_income_rs === undefined
        ? null
        : Number(record.monthly_income_rs),
    weekly_focus_habit: record.weekly_focus_habit ? String(record.weekly_focus_habit) : null,
    weekly_focus_set_at: record.weekly_focus_set_at ? String(record.weekly_focus_set_at) : null,
    open_loop_followups_enabled: record.open_loop_followups_enabled !== false,
    proactive_checkins_paused_until: record.proactive_checkins_paused_until
      ? String(record.proactive_checkins_paused_until)
      : null,
    quiet_hours_enabled: record.quiet_hours_enabled !== false,
    quiet_hours_start_hour:
      record.quiet_hours_start_hour === null || record.quiet_hours_start_hour === undefined
        ? 22
        : Number(record.quiet_hours_start_hour),
    quiet_hours_end_hour:
      record.quiet_hours_end_hour === null || record.quiet_hours_end_hour === undefined
        ? 7
        : Number(record.quiet_hours_end_hour),
    notification_config: sanitizeNotificationConfig(record.notification_config),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export async function findUserByPhoneNumber(phoneNumber: string): Promise<MauriUser | null> {
  const { data, error } = await supabase.from("users").select("*").eq("phone_number", phoneNumber).maybeSingle();

  if (error) {
    throw new Error(`Failed to load user by phone number: ${error.message}`);
  }

  return data ? mapUser(data) : null;
}

export async function findUserById(userId: string): Promise<MauriUser | null> {
  const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load user by id: ${error.message}`);
  }

  return data ? mapUser(data) : null;
}

export async function getOrCreateUser(
  phoneNumber: string,
  firstName?: string
): Promise<{ user: MauriUser; isNewUser: boolean }> {
  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("*")
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (existingUserError) {
    throw new Error(`Failed to load user: ${existingUserError.message}`);
  }

  if (existingUser) {
    if (firstName && existingUser.first_name !== firstName) {
      const { data: updatedUser, error: updatedUserError } = await supabase
        .from("users")
        .update({
          first_name: firstName,
          updated_at: new Date().toISOString()
        })
        .eq("id", existingUser.id)
        .select("*")
        .single();

      if (updatedUserError) {
        throw new Error(`Failed to update user profile: ${updatedUserError.message}`);
      }

      return {
        user: mapUser(updatedUser),
        isNewUser: false
      };
    }

    return {
      user: mapUser(existingUser),
      isNewUser: false
    };
  }

  const { data: createdUser, error: createdUserError } = await supabase
    .from("users")
    .insert({
      phone_number: phoneNumber,
      first_name: firstName ?? null,
      onboarding_state: "awaiting_know_you",
      subscription_status: "Trial_Active"
    })
    .select("*")
    .single();

  if (createdUserError) {
    throw new Error(`Failed to create user: ${createdUserError.message}`);
  }

  return {
    user: mapUser(createdUser),
    isNewUser: true
  };
}

export async function updateUserState(
  userId: string,
  updates: Record<string, unknown>
): Promise<MauriUser> {
  const { data, error } = await supabase
    .from("users")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update user state: ${error.message}`);
  }

  return mapUser(data);
}
