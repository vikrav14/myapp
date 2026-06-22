import { randomBytes } from "node:crypto";

import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

export interface SquadRecord {
  id: string;
  squad_code: string;
  squad_name: string;
  member_ids: string[];
  created_at: string;
}

export interface SquadCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

function mapSquad(record: Record<string, unknown>): SquadRecord {
  return {
    id: String(record.id),
    squad_code: String(record.squad_code),
    squad_name: String(record.squad_name),
    member_ids: Array.isArray(record.member_ids) ? record.member_ids.map(String) : [],
    created_at: String(record.created_at)
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function generateSquadCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function displayName(user: MauriUser): string {
  return user.first_name?.trim() || "You";
}

function isPaidActive(user: MauriUser): boolean {
  if (user.subscription_status !== "Paid_Active") {
    return false;
  }

  if (!user.subscription_ends_at) {
    return true;
  }

  return new Date(user.subscription_ends_at).getTime() > Date.now();
}

function premiumRequiredReply(): string {
  return "Mauri Squads are a premium feature. Unlock premium first, then you can create or join a squad here.";
}

export function parseSquadCommand(message: string): {
  type: "create" | "join" | "status" | "leave" | "share";
  squadName?: string | undefined;
  squadCode?: string | undefined;
} | null {
  const normalized = normalize(message);
  const compact = normalized.replace(/\s+/g, " ");

  const createMatch = compact.match(/^(?:create squad|squad create)(?:\s+(.+))?$/);
  if (createMatch) {
    return {
      type: "create",
      squadName: createMatch[1]?.trim() || undefined
    };
  }

  const joinMatch = compact.match(/^(?:join(?:\s+squad)?|squad join)\s+([a-z0-9-]{4,12})$/);
  if (joinMatch) {
    return {
      type: "join",
      squadCode: joinMatch[1]?.toUpperCase()
    };
  }

  if (compact === "squad status" || compact === "my squad" || compact === "squad") {
    return { type: "status" };
  }

  if (compact === "leave squad" || compact === "squad leave") {
    return { type: "leave" };
  }

  if (
    compact === "share squad" ||
    compact === "squad share" ||
    compact === "invite squad" ||
    compact === "squad invite" ||
    compact === "squad invite message"
  ) {
    return { type: "share" };
  }

  return null;
}

export function buildSquadInviteMessage(squad: Pick<SquadRecord, "squad_name" | "squad_code">): string {
  return `Join my Mauri squad "${squad.squad_name}".

Open WhatsApp, message Mauri, and reply:
join ${squad.squad_code}

Private accountability only — no group chat. Mauri nudges us when someone drifts.`;
}

function buildSquadCreatedReply(squad: SquadRecord): string {
  return `Squad live: ${squad.squad_name}

Code: ${squad.squad_code}

Copy and forward this invite:

${buildSquadInviteMessage(squad)}

Reply "share squad" anytime to get this invite again.`;
}

export async function findSquadForUser(userId: string): Promise<SquadRecord | null> {
  const { data, error } = await supabase.from("squads").select("*").contains("member_ids", [userId]).maybeSingle();

  if (error) {
    throw new Error(`Failed to find squad for user: ${error.message}`);
  }

  return data ? mapSquad(data as Record<string, unknown>) : null;
}

export async function getSquadById(squadId: string): Promise<SquadRecord | null> {
  const { data, error } = await supabase.from("squads").select("*").eq("id", squadId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load squad: ${error.message}`);
  }

  return data ? mapSquad(data as Record<string, unknown>) : null;
}

export async function updateSquadName(
  squadId: string,
  squadName: string,
  requestId?: string | undefined
): Promise<SquadRecord> {
  const { data, error } = await supabase
    .from("squads")
    .update({
      squad_name: squadName.trim()
    })
    .eq("id", squadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update squad name: ${error.message}`);
  }

  const squad = mapSquad(data as Record<string, unknown>);
  await recordAuditEventBestEffort({
    requestId,
    eventType: "admin_squad_updated",
    severity: "info",
    actorType: "admin_api",
    entityType: "squad",
    entityId: squad.id,
    message: "Admin updated squad name.",
    metadata: {
      squadCode: squad.squad_code,
      squadName: squad.squad_name
    }
  });

  return squad;
}

export async function removeSquadMemberById(input: {
  squadId: string;
  userId: string;
  requestId?: string | undefined;
}): Promise<SquadRecord | null> {
  const squad = await getSquadById(input.squadId);
  if (!squad) {
    throw new Error("Squad not found.");
  }

  if (!squad.member_ids.includes(input.userId)) {
    throw new Error("User is not a member of this squad.");
  }

  const remainingMembers = squad.member_ids.filter((memberId) => memberId !== input.userId);
  if (remainingMembers.length === 0) {
    const { error: deleteError } = await supabase.from("squads").delete().eq("id", squad.id);
    if (deleteError) {
      throw new Error(`Failed to delete empty squad: ${deleteError.message}`);
    }

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "admin_squad_member_removed",
      severity: "info",
      actorType: "admin_api",
      userId: input.userId,
      entityType: "squad",
      entityId: squad.id,
      message: "Admin removed the last squad member and dissolved the squad.",
      metadata: {
        squadCode: squad.squad_code
      }
    });

    return null;
  }

  const updated = await saveSquadMembers(squad.id, remainingMembers);
  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "admin_squad_member_removed",
    severity: "info",
    actorType: "admin_api",
    userId: input.userId,
    entityType: "squad",
    entityId: updated.id,
    message: "Admin removed a squad member.",
    metadata: {
      squadCode: updated.squad_code
    }
  });

  return updated;
}

export async function dissolveSquadById(squadId: string, requestId?: string | undefined): Promise<void> {
  const squad = await getSquadById(squadId);
  if (!squad) {
    throw new Error("Squad not found.");
  }

  const { error } = await supabase.from("squads").delete().eq("id", squadId);
  if (error) {
    throw new Error(`Failed to dissolve squad: ${error.message}`);
  }

  await recordAuditEventBestEffort({
    requestId,
    eventType: "admin_squad_dissolved",
    severity: "info",
    actorType: "admin_api",
    entityType: "squad",
    entityId: squad.id,
    message: "Admin dissolved a Mauri squad.",
    metadata: {
      squadCode: squad.squad_code,
      squadName: squad.squad_name,
      memberCount: squad.member_ids.length
    }
  });
}

async function saveSquadMembers(squadId: string, memberIds: string[]): Promise<SquadRecord> {
  const { data, error } = await supabase
    .from("squads")
    .update({
      member_ids: memberIds
    })
    .eq("id", squadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update squad members: ${error.message}`);
  }

  return mapSquad(data as Record<string, unknown>);
}

export async function createSquadForUser(
  user: MauriUser,
  squadName?: string | undefined,
  requestId?: string | undefined
): Promise<SquadRecord> {
  const existing = await findSquadForUser(user.id);
  if (existing) {
    return existing;
  }

  let squadCode = generateSquadCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("squads")
      .insert({
        squad_code: squadCode,
        squad_name: squadName?.trim() || `${displayName(user)}'s Squad`,
        member_ids: [user.id]
      })
      .select("*")
      .single();

    if (!error && data) {
      const squad = mapSquad(data as Record<string, unknown>);
      await recordAuditEventBestEffort({
        requestId,
        eventType: "squad_created",
        userId: user.id,
        entityType: "squad",
        entityId: squad.id,
        message: "User created a Mauri squad.",
        metadata: {
          squadCode: squad.squad_code,
          squadName: squad.squad_name
        }
      });
      return squad;
    }

    if (error?.code === "23505") {
      squadCode = generateSquadCode();
      continue;
    }

    throw new Error(`Failed to create squad: ${error?.message ?? "unknown error"}`);
  }

  throw new Error("Failed to create squad after multiple code attempts.");
}

export async function joinSquadByCode(
  user: MauriUser,
  squadCode: string,
  requestId?: string | undefined
): Promise<SquadRecord> {
  const existing = await findSquadForUser(user.id);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("squads")
    .select("*")
    .eq("squad_code", squadCode.toUpperCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load squad by code: ${error.message}`);
  }

  if (!data) {
    throw new Error("Squad not found.");
  }

  const squad = mapSquad(data as Record<string, unknown>);
  if (squad.member_ids.includes(user.id)) {
    return squad;
  }

  const updated = await saveSquadMembers(squad.id, [...squad.member_ids, user.id]);

  await recordAuditEventBestEffort({
    requestId,
    eventType: "squad_joined",
    userId: user.id,
    entityType: "squad",
    entityId: updated.id,
    message: "User joined a Mauri squad.",
    metadata: {
      squadCode: updated.squad_code,
      squadName: updated.squad_name
    }
  });

  return updated;
}

export async function leaveSquadForUser(user: MauriUser, requestId?: string | undefined): Promise<SquadRecord | null> {
  const squad = await findSquadForUser(user.id);
  if (!squad) {
    return null;
  }

  const remainingMembers = squad.member_ids.filter((memberId) => memberId !== user.id);
  const { error: deleteError } = await supabase.from("squads").delete().eq("id", squad.id);

  if (remainingMembers.length === 0) {
    if (deleteError) {
      throw new Error(`Failed to delete empty squad: ${deleteError.message}`);
    }

    await recordAuditEventBestEffort({
      requestId,
      eventType: "squad_left",
      userId: user.id,
      entityType: "squad",
      entityId: squad.id,
      message: "User left and dissolved an empty Mauri squad.",
      metadata: {
        squadCode: squad.squad_code
      }
    });

    return null;
  }

  const updated = await saveSquadMembers(squad.id, remainingMembers);

  await recordAuditEventBestEffort({
    requestId,
    eventType: "squad_left",
    userId: user.id,
    entityType: "squad",
    entityId: updated.id,
    message: "User left a Mauri squad.",
    metadata: {
      squadCode: updated.squad_code
    }
  });

  return updated;
}

export async function handleSquadMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<SquadCommandResult> {
  const command = parseSquadCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (!isPaidActive(input.user)) {
    return {
      handled: true,
      reply: premiumRequiredReply()
    };
  }

  if (command.type === "create") {
    const squad = await createSquadForUser(input.user, command.squadName, input.requestId);
    return {
      handled: true,
      reply: buildSquadCreatedReply(squad)
    };
  }

  if (command.type === "join") {
    try {
      const squad = await joinSquadByCode(input.user, command.squadCode ?? "", input.requestId);
      return {
        handled: true,
        reply: `You’re in ${squad.squad_name}.

Code ${squad.squad_code} is locked in.

Want to invite someone? Reply "share squad" for a copy-paste invite message.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not join that squad.";
      return {
        handled: true,
        reply:
          message === "Squad not found."
            ? "That squad code doesn’t exist. Double-check it and try again."
            : "I couldn’t join that squad right now. Try again in a minute."
      };
    }
  }

  if (command.type === "status") {
    const squad = await findSquadForUser(input.user.id);
    if (!squad) {
      return {
        handled: true,
        reply: `You’re not in a squad yet.

Reply "create squad" to start one, or "join CODE" if someone already sent you a code.`
      };
    }

    return {
      handled: true,
      reply: `You’re in ${squad.squad_name}.

Code: ${squad.squad_code}
Members: ${squad.member_ids.length}

Reply "share squad" for an invite message, or "leave squad" if you want out.`
    };
  }

  if (command.type === "share") {
    const squad = await findSquadForUser(input.user.id);
    if (!squad) {
      return {
        handled: true,
        reply: `You’re not in a squad yet.

Reply "create squad" to start one, or "join CODE" if someone already sent you a code.`
      };
    }

    return {
      handled: true,
      reply: `Share this invite with anyone you want in ${squad.squad_name}:

${buildSquadInviteMessage(squad)}`
    };
  }

  const updated = await leaveSquadForUser(input.user, input.requestId);
  return {
    handled: true,
    reply: updated
      ? `You left ${updated.squad_name}.`
      : "You left your squad. Reply \"create squad\" or \"join CODE\" when you want back in."
  };
}

export async function listPaidMemberIds(memberIds: string[]): Promise<string[]> {
  if (!memberIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, subscription_ends_at")
    .in("id", memberIds)
    .eq("subscription_status", "Paid_Active");

  if (error) {
    throw new Error(`Failed to load paid squad members: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => {
      const subscriptionEndsAt = row.subscription_ends_at ? String(row.subscription_ends_at) : null;
      return !subscriptionEndsAt || new Date(subscriptionEndsAt).getTime() > Date.now();
    })
    .map((row) => String(row.id));
}
