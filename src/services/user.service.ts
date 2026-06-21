import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";

function mapUser(record: Record<string, unknown>): MauriUser {
  return {
    id: String(record.id),
    phone_number: String(record.phone_number),
    first_name: record.first_name ? String(record.first_name) : null,
    archetype: String(record.archetype ?? "Life & Habit Tracking"),
    subscription_status: (record.subscription_status ?? "Trial_Active") as MauriUser["subscription_status"],
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export async function getOrCreateUser(phoneNumber: string, firstName?: string): Promise<MauriUser> {
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

      return mapUser(updatedUser);
    }

    return mapUser(existingUser);
  }

  const { data: createdUser, error: createdUserError } = await supabase
    .from("users")
    .insert({
      phone_number: phoneNumber,
      first_name: firstName ?? null
    })
    .select("*")
    .single();

  if (createdUserError) {
    throw new Error(`Failed to create user: ${createdUserError.message}`);
  }

  return mapUser(createdUser);
}
