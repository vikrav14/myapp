import type { MauriModuleKey } from "./user-modules.constants.js";
import {
  MAURI_MODULE_KEYS,
  MAX_ACTIVE_MODULES,
  MODULE_CATALOG,
  PRIMARY_DEFAULT_MODULE,
  PRIMARY_LANE_TO_SUGGESTED_EXTRA
} from "./user-modules.constants.js";
import type { MauriUser, UserMindFact } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE, isCustomLaneArchetype } from "../types.js";
import { displayPrimaryLaneLabel } from "./brief-focus.service.js";
import { hasPrivateFinanceSignal, isRetiredOrElderProfile } from "./profile-inference.service.js";
import { updateUserState } from "./user.service.js";

export function normalizeModuleKey(value: string): MauriModuleKey | null {
  const normalized = value.trim().toLowerCase();
  if ((MAURI_MODULE_KEYS as readonly string[]).includes(normalized)) {
    return normalized as MauriModuleKey;
  }

  return null;
}

export function hasModule(user: Pick<MauriUser, "active_modules">, module: MauriModuleKey): boolean {
  return user.active_modules.includes(module);
}

export function sanitizeModuleList(modules: string[]): MauriModuleKey[] {
  const unique: MauriModuleKey[] = [];

  for (const value of modules) {
    const key = normalizeModuleKey(value);
    if (!key || unique.includes(key)) {
      continue;
    }

    unique.push(key);
    if (unique.length >= MAX_ACTIVE_MODULES) {
      break;
    }
  }

  return unique;
}

export function defaultModuleForPrimaryLane(primaryLane: string): MauriModuleKey | null {
  return PRIMARY_DEFAULT_MODULE[primaryLane] ?? null;
}

export function suggestModulesFromFacts(facts: UserMindFact[], primaryLane: string): MauriModuleKey[] {
  const modules: MauriModuleKey[] = [];
  const primaryDefault = defaultModuleForPrimaryLane(primaryLane);
  const elderProfile = isRetiredOrElderProfile(facts);
  const privateFinance = hasPrivateFinanceSignal(facts);

  if (elderProfile && privateFinance) {
    modules.push("career");
  } else if (primaryDefault) {
    modules.push(primaryDefault);
  }

  const extra = PRIMARY_LANE_TO_SUGGESTED_EXTRA[primaryLane];
  const hasHeavyLoad = facts.some(
    (fact) => fact.category === "stressors" || fact.category === "relationships"
  );
  const hasFounderSignal = facts.some((fact) => {
    const blob = `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
    return /founder|startup|side hustle|side app|business|building my app|entrepreneur/.test(blob);
  });
  const hasStudentSignal = facts.some((fact) => {
    const blob = `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
    if (/\b(daughter|son|child|kid|saving for|their uni|their university)\b/.test(blob)) {
      return false;
    }

    return (
      /\b(i'm a student|i am a student|student at|studying|final year|my exams|uom|utm)\b/.test(blob) ||
      (fact.category === "life_context" && /\b(student|studying|uom|utm)\b/.test(blob))
    );
  });

  if (privateFinance && !modules.includes("career")) {
    modules.push("career");
  }

  if (hasHeavyLoad && !modules.includes("habits") && !elderProfile && !privateFinance) {
    modules.push("habits");
  } else if (extra && !modules.includes(extra) && !(elderProfile && privateFinance && extra === "habits")) {
    modules.push(extra);
  }

  if (hasFounderSignal && primaryLane !== "Entrepreneur Mode" && !modules.includes("founder")) {
    modules.push("founder");
  }

  if (hasStudentSignal && primaryLane !== "Student Grind" && !modules.includes("student")) {
    modules.push("student");
  }

  return sanitizeModuleList(modules);
}

export function formatModuleLabels(modules: MauriModuleKey[]): string {
  if (modules.length === 0) {
    return "brief only (no extra modules)";
  }

  return modules.map((module) => MODULE_CATALOG[module].shortLabel).join(" + ");
}

export function buildModuleStepIntro(input: {
  user: MauriUser;
  suggestedModules: MauriModuleKey[];
}): string {
  const name = input.user.first_name?.trim() || "there";
  const lane = displayPrimaryLaneLabel(input.user);
  const suggestedLine =
    input.suggestedModules.length > 0
      ? `Suggested for you: ${formatModuleLabels(input.suggestedModules)}.`
      : "Pick any tools you want — or keep it brief-only.";

  return `${name} — ${lane} shapes your 7am brief.

${suggestedLine}

Modules unlock extra backend stuff (payday runway, habit check-ins, etc.) — separate from your brief lane.

Tap Pick modules below, or reply e.g. career habits`;
}

export function buildModulesStatusReply(user: MauriUser): string {
  const lane = user.archetype;
  const active = sanitizeModuleList(user.active_modules);

  const lines = [
    `Brief lane: ${lane}`,
    `Active modules: ${formatModuleLabels(active)}`,
    "",
    "Modules unlock:",
    "- career — payday runway in brief, work/todo nudges",
    "- habits — mood/routine check-ins, weekly focus nudges",
    "- founder — side-hustle cashflow nudges",
    "- student — study/exam nudges",
    "",
    "Change anytime:",
    "add habits",
    "remove founder",
    "my lane — brief lane + tags"
  ];

  return lines.join("\n");
}

export function parseModuleToggleCommand(message: string): { action: "add" | "remove"; module: MauriModuleKey } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  const addMatch = normalized.match(/^add\s+(career|habits|founder|student)$/);
  if (addMatch?.[1]) {
    return { action: "add", module: addMatch[1] as MauriModuleKey };
  }

  const removeMatch = normalized.match(/^remove\s+(career|habits|founder|student)$/);
  if (removeMatch?.[1]) {
    return { action: "remove", module: removeMatch[1] as MauriModuleKey };
  }

  return null;
}

export function parseMyModulesCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "my modules" || normalized === "modules" || normalized === "my module";
}

export function parseMyLaneCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "my lane" || normalized === "brief lane" || normalized === "my brief lane";
}

export function parseOnboardingModuleSelection(input: {
  message: string;
  primaryLane: string;
  facts: UserMindFact[];
}): MauriModuleKey[] | "invalid_custom" | null {
  const normalized = input.message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "modules suggested" ||
    normalized === "use suggested" ||
    normalized === "suggested" ||
    normalized === "module suggested"
  ) {
    return suggestModulesFromFacts(input.facts, input.primaryLane);
  }

  if (
    normalized === "modules none" ||
    normalized === "brief only" ||
    normalized === "none" ||
    normalized === "skip modules" ||
    normalized === "no modules"
  ) {
    if (isCustomLaneArchetype(input.primaryLane)) {
      return "invalid_custom";
    }

    return [];
  }

  if (normalized.startsWith("modules ")) {
    const tokens = normalized.replace(/^modules\s+/, "").split(/[\s,+/]+/).filter(Boolean);
    const parsed = sanitizeModuleList(tokens);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const tokens = normalized.split(/[\s,+/]+/).filter(Boolean);
  const parsed = sanitizeModuleList(tokens);
  if (parsed.length > 0) {
    return parsed;
  }

  return null;
}

export function finalizeOnboardingModules(
  selected: MauriModuleKey[],
  primaryLane: string
): MauriModuleKey[] {
  if (selected.length === 0) {
    return [];
  }

  const primaryDefault = defaultModuleForPrimaryLane(primaryLane);
  if (primaryDefault) {
    return sanitizeModuleList([primaryDefault, ...selected]);
  }

  return sanitizeModuleList(selected);
}

export function resolveInteractiveModuleSelection(replyId: string): string | null {
  const map: Record<string, string> = {
    module_suggested: "modules suggested",
    module_career: "modules career",
    module_habits: "modules habits",
    module_founder: "modules founder",
    module_student: "modules student",
    module_none: "modules none"
  };

  return map[replyId] ?? null;
}

export async function applyModuleToggle(input: {
  user: MauriUser;
  action: "add" | "remove";
  module: MauriModuleKey;
}): Promise<{ user: MauriUser; reply: string }> {
  const current = sanitizeModuleList(input.user.active_modules);

  if (input.action === "add") {
    if (current.includes(input.module)) {
      return {
        user: input.user,
        reply: `${MODULE_CATALOG[input.module].label} is already on.\n\n${buildModulesStatusReply(input.user)}`
      };
    }

    if (current.length >= MAX_ACTIVE_MODULES) {
      return {
        user: input.user,
        reply: `You can have up to ${MAX_ACTIVE_MODULES} modules active. Remove one first — e.g. remove ${current[0]}.`
      };
    }

    const next = sanitizeModuleList([...current, input.module]);
    const updatedUser = await updateUserState(input.user.id, { active_modules: next });
    return {
      user: updatedUser,
      reply: `Added ${MODULE_CATALOG[input.module].label}.\n\n${buildModulesStatusReply(updatedUser)}`
    };
  }

  if (!current.includes(input.module)) {
    return {
      user: input.user,
      reply: `${MODULE_CATALOG[input.module].label} isn't active.\n\n${buildModulesStatusReply(input.user)}`
    };
  }

  const next = current.filter((module) => module !== input.module);
  const updatedUser = await updateUserState(input.user.id, { active_modules: next });
  return {
    user: updatedUser,
    reply: `Removed ${MODULE_CATALOG[input.module].label}.\n\n${buildModulesStatusReply(updatedUser)}`
  };
}

export function buildLaneStatusReply(user: MauriUser): string {
  const tags =
    user.topic_preferences.length > 0
      ? user.topic_preferences.map((topic) => `#${topic}`).join(" ")
      : "not set yet";

  return `Brief lane: ${displayPrimaryLaneLabel(user)}
${user.brief_focus?.trim() && isCustomLaneArchetype(user.archetype) ? `Brief focus: ${user.brief_focus.trim()}\n` : ""}Morning brief tags: ${tags}
Active modules: ${formatModuleLabels(sanitizeModuleList(user.active_modules))}

Change modules: add habits / remove founder
Change tags: update topics Traffic Money Tech`;
}
