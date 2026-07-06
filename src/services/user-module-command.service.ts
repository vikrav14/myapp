import type { MauriUser } from "../types.js";
import {
  applyModuleToggle,
  buildLaneStatusReply,
  buildModulesStatusReply,
  parseModuleToggleCommand,
  parseMyLaneCommand,
  parseMyModulesCommand
} from "./user-modules.service.js";

export interface UserModuleCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

export async function handleUserModuleMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<UserModuleCommandResult> {
  if (input.user.onboarding_state !== "active") {
    return { handled: false, user: input.user };
  }

  if (parseMyModulesCommand(input.message)) {
    return {
      handled: true,
      user: input.user,
      reply: buildModulesStatusReply(input.user)
    };
  }

  if (parseMyLaneCommand(input.message)) {
    return {
      handled: true,
      user: input.user,
      reply: buildLaneStatusReply(input.user)
    };
  }

  const toggle = parseModuleToggleCommand(input.message);
  if (toggle) {
    const result = await applyModuleToggle({
      user: input.user,
      action: toggle.action,
      module: toggle.module
    });

    return {
      handled: true,
      user: result.user,
      reply: result.reply
    };
  }

  return { handled: false, user: input.user };
}
