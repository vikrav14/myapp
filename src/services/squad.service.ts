import { randomBytes } from "node:crypto";

import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  buildCustomSquadGoalSetReply,
  buildSquadCreatedPactHint,
  buildSquadGoalSetReply,
  buildSquadGoalShowReply,
  buildCustomSquadWeights,
  getSquadPactDefinition,
  parseSquadGoalCommand,
  parseStoredSquadPactWeights,
  suggestedPactKeyForArchetype,
  type SquadPactFocus,
  type SquadPactKey,
  type SquadPactWeightsRecord
} from "./squad-pact.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export interface SquadRecord {
  id: string;
  squad_code: string;
  squad_name: string;
  member_ids: string[];
  created_at: string;
  weekly_pact_key: string | null;
  weekly_pact_label: string | null;
  weekly_pact_set_at: string | null;
  weekly_pact_set_by: string | null;
  weekly_pact_weights: SquadPactWeightsRecord | null;
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
    created_at: String(record.created_at),
    weekly_pact_key: record.weekly_pact_key ? String(record.weekly_pact_key) : null,
    weekly_pact_label: record.weekly_pact_label ? String(record.weekly_pact_label) : null,
    weekly_pact_set_at: record.weekly_pact_set_at ? String(record.weekly_pact_set_at) : null,
    weekly_pact_set_by: record.weekly_pact_set_by ? String(record.weekly_pact_set_by) : null,
    weekly_pact_weights: parseSquadWeeklyPactWeights(record.weekly_pact_weights)
  };
}

function parseSquadWeeklyPactWeights(value: unknown): SquadPactWeightsRecord | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseStoredSquadPactWeights(value);
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

export function hasSquadAccess(user: MauriUser): boolean {
  if (user.subscription_status === "Trial_Active") {
    if (!user.trial_ends_at) {
      return true;
    }

    return new Date(user.trial_ends_at).getTime() > Date.now();
  }

  if (user.subscription_status !== "Paid_Active") {
    return false;
  }

  if (!user.subscription_ends_at) {
    return true;
  }

  return new Date(user.subscription_ends_at).getTime() > Date.now();
}

function squadAccessRequiredReply(): string {
  return "Mauri Squads need an active trial or premium. Unlock premium to keep your squad after trial ends.";
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

function buildSquadCreatedReply(squad: SquadRecord, user: MauriUser): string {
  const pactNote =
    squad.weekly_pact_label != null
      ? `Weekly pact: ${squad.weekly_pact_label} (auto-set from your ${user.archetype} lane).`
      : buildSquadCreatedPactHint(user.archetype);

  return `Squad live: ${squad.squad_name}

Code: ${squad.squad_code}

${pactNote}

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

      const suggestedPact = suggestedPactKeyForArchetype(user.archetype);
      return setSquadWeeklyPact({
        squadId: squad.id,
        pactKey: suggestedPact,
        setByUserId: user.id,
        requestId
      });
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

export async function setSquadWeeklyPact(input: {
  squadId: string;
  pactKey: SquadPactKey;
  setByUserId: string;
  requestId?: string | undefined;
}): Promise<SquadRecord> {
  const pact = getSquadPactDefinition(input.pactKey);
  if (!pact) {
    throw new Error("Invalid squad pact.");
  }

  const { data, error } = await supabase
    .from("squads")
    .update({
      weekly_pact_key: pact.key,
      weekly_pact_label: pact.label,
      weekly_pact_set_at: new Date().toISOString(),
      weekly_pact_set_by: input.setByUserId,
      weekly_pact_weights: null
    })
    .eq("id", input.squadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to set squad pact: ${error.message}`);
  }

  const squad = mapSquad(data as Record<string, unknown>);
  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "squad_pact_set",
    userId: input.setByUserId,
    entityType: "squad",
    entityId: squad.id,
    message: "User set a squad weekly pact.",
    metadata: {
      squadCode: squad.squad_code,
      pactKey: pact.key,
      pactLabel: pact.label
    }
  });

  return squad;
}

export async function setSquadCustomPact(input: {
  squadId: string;
  label: string;
  focus: SquadPactFocus[];
  setByUserId: string;
  requestId?: string | undefined;
}): Promise<SquadRecord> {
  const weights = buildCustomSquadWeights(input.focus);
  const payload: SquadPactWeightsRecord = {
    ...weights,
    focus: input.focus
  };

  const { data, error } = await supabase
    .from("squads")
    .update({
      weekly_pact_key: "custom",
      weekly_pact_label: input.label.trim(),
      weekly_pact_set_at: new Date().toISOString(),
      weekly_pact_set_by: input.setByUserId,
      weekly_pact_weights: payload
    })
    .eq("id", input.squadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to set custom squad pact: ${error.message}`);
  }

  const squad = mapSquad(data as Record<string, unknown>);
  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "squad_pact_set",
    userId: input.setByUserId,
    entityType: "squad",
    entityId: squad.id,
    message: "User set a custom squad weekly pact.",
    metadata: {
      squadCode: squad.squad_code,
      pactKey: "custom",
      pactLabel: input.label,
      focus: input.focus
    }
  });

  return squad;
}

export async function clearSquadWeeklyPact(squadId: string, requestId?: string | undefined): Promise<SquadRecord> {
  const { data, error } = await supabase
    .from("squads")
    .update({
      weekly_pact_key: null,
      weekly_pact_label: null,
      weekly_pact_set_at: null,
      weekly_pact_set_by: null,
      weekly_pact_weights: null
    })
    .eq("id", squadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to clear squad pact: ${error.message}`);
  }

  const squad = mapSquad(data as Record<string, unknown>);
  await recordAuditEventBestEffort({
    requestId,
    eventType: "squad_pact_cleared",
    entityType: "squad",
    entityId: squad.id,
    message: "Squad weekly pact cleared.",
    metadata: {
      squadCode: squad.squad_code
    }
  });

  return squad;
}

async function notifySquadMembersOfPactChange(input: {
  squad: SquadRecord;
  actor: MauriUser;
  pactLabel: string;
  requestId?: string | undefined;
}): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .select("id, phone_number, first_name")
    .in("id", input.squad.member_ids);

  if (error) {
    throw new Error(`Failed to load squad members for pact notification: ${error.message}`);
  }

  const actorName = displayName(input.actor);
  const message = `${actorName} set ${input.squad.squad_name}'s pact for this week: ${input.pactLabel}.

Reply squad goal to see how scoring works.`;

  for (const row of data ?? []) {
    const memberId = String(row.id);
    if (memberId === input.actor.id) {
      continue;
    }

    await sendWhatsAppMessage(String(row.phone_number), message, {
      userId: memberId,
      requestId: input.requestId,
      metadata: {
        flow: "squad_pact_notify",
        squadName: input.squad.squad_name
      }
    });
  }
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
  const goalCommand = parseSquadGoalCommand(input.message);
  const command = goalCommand ? null : parseSquadCommand(input.message);
  if (!goalCommand && !command) {
    return { handled: false };
  }

  if (!hasSquadAccess(input.user)) {
    return {
      handled: true,
      reply: squadAccessRequiredReply()
    };
  }

  if (goalCommand) {
    const squad = await findSquadForUser(input.user.id);
    if (!squad) {
      return {
        handled: true,
        reply: `You're not in a squad yet.

Create one first, then set a pact:
create squad Study Crew
squad goal study | save | hustle | balance`
      };
    }

    if (goalCommand.type === "show") {
      return {
        handled: true,
        reply: buildSquadGoalShowReply(squad)
      };
    }

    if (goalCommand.type === "clear") {
      const cleared = await clearSquadWeeklyPact(squad.id, input.requestId);
      return {
        handled: true,
        reply: `Pact cleared for ${cleared.squad_name}. Default scoring is back on (habits +2, todos +3, money logs +1).`
      };
    }

    if (goalCommand.type === "setCustom") {
      const weights = buildCustomSquadWeights(goalCommand.focus);
      const updated = await setSquadCustomPact({
        squadId: squad.id,
        label: goalCommand.label,
        focus: goalCommand.focus,
        setByUserId: input.user.id,
        requestId: input.requestId
      });

      await notifySquadMembersOfPactChange({
        squad: updated,
        actor: input.user,
        pactLabel: goalCommand.label,
        requestId: input.requestId
      }).catch(() => undefined);

      return {
        handled: true,
        reply: buildCustomSquadGoalSetReply(updated, {
          label: goalCommand.label,
          focus: goalCommand.focus,
          weights
        })
      };
    }

    if (goalCommand.type === "set") {
      const pact = getSquadPactDefinition(goalCommand.pactKey);
      if (!pact) {
        return {
          handled: true,
          reply: buildSquadGoalShowReply(squad)
        };
      }

      const updated = await setSquadWeeklyPact({
        squadId: squad.id,
        pactKey: pact.key,
        setByUserId: input.user.id,
        requestId: input.requestId
      });

      await notifySquadMembersOfPactChange({
        squad: updated,
        actor: input.user,
        pactLabel: pact.label,
        requestId: input.requestId
      }).catch(() => undefined);

      return {
        handled: true,
        reply: buildSquadGoalSetReply(updated, pact)
      };
    }

    return {
      handled: true,
      reply: buildSquadGoalShowReply(squad)
    };
  }

  if (!command) {
    return { handled: false };
  }

  if (command.type === "create") {
    const squad = await createSquadForUser(input.user, command.squadName, input.requestId);
    return {
      handled: true,
      reply: buildSquadCreatedReply(squad, input.user)
    };
  }

  if (command.type === "join") {
    try {
      const squad = await joinSquadByCode(input.user, command.squadCode ?? "", input.requestId);
      return {
        handled: true,
        reply: `You’re in ${squad.squad_name}.

Code ${squad.squad_code} is locked in.

Want to invite someone? Reply "share squad" for a copy-paste invite message.

Set the weekly pact anytime: squad goal study | save | hustle | balance
squad goal custom Your theme — focus study habits todos money`
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
${squad.weekly_pact_label ? `Pact: ${squad.weekly_pact_label}` : "Pact: not set yet"}

Reply "share squad" for an invite, "squad goal" for pact scoring, or "leave squad" if you want out.

Custom pact example: squad goal custom Exam week — focus study todos`
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

function isSquadEligibleRecord(row: {
  subscription_status: unknown;
  trial_ends_at: unknown;
  subscription_ends_at: unknown;
}): boolean {
  const subscriptionStatus = String(row.subscription_status);

  if (subscriptionStatus === "Trial_Active") {
    const trialEndsAt = row.trial_ends_at ? String(row.trial_ends_at) : null;
    return !trialEndsAt || new Date(trialEndsAt).getTime() > Date.now();
  }

  if (subscriptionStatus !== "Paid_Active") {
    return false;
  }

  const subscriptionEndsAt = row.subscription_ends_at ? String(row.subscription_ends_at) : null;
  return !subscriptionEndsAt || new Date(subscriptionEndsAt).getTime() > Date.now();
}

export async function listSquadEligibleMemberIds(memberIds: string[]): Promise<string[]> {
  if (!memberIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, subscription_status, trial_ends_at, subscription_ends_at")
    .in("id", memberIds)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to load squad-eligible members: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => isSquadEligibleRecord(row))
    .map((row) => String(row.id));
}

/** @deprecated Use listSquadEligibleMemberIds */
export async function listPaidMemberIds(memberIds: string[]): Promise<string[]> {
  return listSquadEligibleMemberIds(memberIds);
}
