import { supabase } from "../lib/supabase.js";
import type { MauriUser, MorningBriefTopicKey } from "../types.js";

export function mapUser(record: Record<string, unknown>): MauriUser {
  return {
    id: String(record.id),
    phone_number: String(record.phone_number),
    first_name: record.first_name ? String(record.first_name) : null,
    archetype: String(record.archetype ?? "Life & Habit Tracking"),
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
    weekly_focus_habit: record.weekly_focus_habit ? String(record.weekly_focus_habit) : null,
    weekly_focus_set_at: record.weekly_focus_set_at ? String(record.weekly_focus_set_at) : null,
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
      onboarding_state: "awaiting_archetype",
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
