import { supabase } from "../lib/supabase.js";

export async function hasEngagementDelivery(userId: string, deliveryKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("engagement_deliveries")
    .select("id")
    .eq("user_id", userId)
    .eq("delivery_key", deliveryKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check engagement delivery: ${error.message}`);
  }

  return Boolean(data);
}

export async function recordEngagementDelivery(userId: string, deliveryKey: string): Promise<void> {
  const { error } = await supabase.from("engagement_deliveries").insert({
    user_id: userId,
    delivery_key: deliveryKey
  });

  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to record engagement delivery: ${error.message}`);
  }
}
