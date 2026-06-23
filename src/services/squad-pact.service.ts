import type { SquadRecord } from "./squad.service.js";

export type SquadPactKey = "study" | "save" | "hustle" | "balance";

export interface SquadPactDefinition {
  key: SquadPactKey;
  label: string;
  summary: string;
}

export interface SquadScoringWeights {
  habitSuccess: number;
  studyHabitBonus: number;
  todoComplete: number;
  financeLog: number;
}

export interface SquadHabitLogRow {
  user_id: string;
  activity_type: string;
  is_success: boolean;
}

export interface SquadTodoLogRow {
  user_id: string;
}

export interface SquadFinanceLogRow {
  user_id: string;
}

const PACT_CATALOG: Record<SquadPactKey, SquadPactDefinition> = {
  study: {
    key: "study",
    label: "Study sprint",
    summary: "Study habits score extra; todos still count."
  },
  save: {
    key: "save",
    label: "Save money week",
    summary: "Logging spending counts triple — awareness beats denial."
  },
  hustle: {
    key: "hustle",
    label: "Hustle week",
    summary: "Completed tasks score highest."
  },
  balance: {
    key: "balance",
    label: "Balance week",
    summary: "Habits and tasks both get a boost."
  }
};

const DEFAULT_WEIGHTS: SquadScoringWeights = {
  habitSuccess: 2,
  studyHabitBonus: 0,
  todoComplete: 3,
  financeLog: 1
};

const PACT_WEIGHTS: Record<SquadPactKey, SquadScoringWeights> = {
  study: {
    habitSuccess: 2,
    studyHabitBonus: 4,
    todoComplete: 2,
    financeLog: 1
  },
  save: {
    habitSuccess: 2,
    studyHabitBonus: 0,
    todoComplete: 2,
    financeLog: 3
  },
  hustle: {
    habitSuccess: 2,
    studyHabitBonus: 0,
    todoComplete: 5,
    financeLog: 2
  },
  balance: {
    habitSuccess: 3,
    studyHabitBonus: 0,
    todoComplete: 3,
    financeLog: 2
  }
};

export function listSquadPactOptions(): SquadPactDefinition[] {
  return Object.values(PACT_CATALOG);
}

export function getSquadPactDefinition(key: string | null | undefined): SquadPactDefinition | null {
  if (!key || !(key in PACT_CATALOG)) {
    return null;
  }

  return PACT_CATALOG[key as SquadPactKey];
}

export function parseSquadPactKey(value: string): SquadPactKey | null {
  const normalized = value.trim().toLowerCase();
  if (normalized in PACT_CATALOG) {
    return normalized as SquadPactKey;
  }

  return null;
}

export function parseSquadGoalCommand(message: string): {
  type: "show" | "set" | "clear";
  pactKey?: SquadPactKey | undefined;
} | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "squad goal" ||
    normalized === "squad pact" ||
    normalized === "my squad goal" ||
    normalized === "squad goal status"
  ) {
    return { type: "show" };
  }

  if (normalized === "squad goal clear" || normalized === "squad pact clear" || normalized === "clear squad goal") {
    return { type: "clear" };
  }

  const setMatch = normalized.match(/^(?:set\s+)?squad\s+(?:goal|pact)\s+([a-z]+)$/);
  if (setMatch) {
    const pactKey = parseSquadPactKey(setMatch[1] ?? "");
    if (!pactKey) {
      return { type: "show" };
    }

    return { type: "set", pactKey };
  }

  return null;
}

export function scoringWeightsForSquad(squad: Pick<SquadRecord, "weekly_pact_key">): SquadScoringWeights {
  const pact = getSquadPactDefinition(squad.weekly_pact_key);
  if (!pact) {
    return DEFAULT_WEIGHTS;
  }

  return PACT_WEIGHTS[pact.key];
}

export function isStudyHabitActivity(activityType: string): boolean {
  const normalized = activityType.trim().toLowerCase();
  return (
    normalized.includes("study") ||
    normalized.includes("read") ||
    normalized.includes("exam") ||
    normalized.includes("deep")
  );
}

export function scoreMemberLogs(input: {
  memberIds: string[];
  weights: SquadScoringWeights;
  habitRows: SquadHabitLogRow[];
  todoRows: SquadTodoLogRow[];
  financeRows: SquadFinanceLogRow[];
}): Map<string, number> {
  const scores = new Map<string, number>();

  for (const memberId of input.memberIds) {
    scores.set(memberId, 0);
  }

  for (const row of input.habitRows) {
    if (!row.is_success) {
      continue;
    }

    const userId = String(row.user_id);
    let delta = input.weights.habitSuccess;
    if (input.weights.studyHabitBonus > 0 && isStudyHabitActivity(String(row.activity_type ?? ""))) {
      delta += input.weights.studyHabitBonus;
    }

    scores.set(userId, (scores.get(userId) ?? 0) + delta);
  }

  for (const row of input.todoRows) {
    const userId = String(row.user_id);
    scores.set(userId, (scores.get(userId) ?? 0) + input.weights.todoComplete);
  }

  for (const row of input.financeRows) {
    const userId = String(row.user_id);
    scores.set(userId, (scores.get(userId) ?? 0) + input.weights.financeLog);
  }

  return scores;
}

export function formatSquadPactLine(squad: Pick<SquadRecord, "weekly_pact_key" | "weekly_pact_label">): string | null {
  const pact = getSquadPactDefinition(squad.weekly_pact_key);
  if (!pact) {
    return null;
  }

  const label = squad.weekly_pact_label?.trim() || pact.label;
  return `This week's pact: ${label} — ${pact.summary}`;
}

export function buildSquadGoalOptionsText(): string {
  return listSquadPactOptions()
    .map((pact) => `${pact.key} — ${pact.label}`)
    .join("\n");
}

export function buildSquadGoalShowReply(squad: SquadRecord): string {
  const pactLine = formatSquadPactLine(squad);
  if (!pactLine) {
    return `No squad pact set for ${squad.squad_name} yet.

Pick one for this week:
${buildSquadGoalOptionsText()}

Reply: squad goal study | save | hustle | balance`;
  }

  const weights = scoringWeightsForSquad(squad);
  const weightLine = describeScoringWeights(weights, squad.weekly_pact_key);

  return `${pactLine}

Scoring this week: ${weightLine}

Change it anytime:
squad goal study | save | hustle | balance
squad goal clear — back to default scoring`;
}

export function buildSquadGoalSetReply(squad: SquadRecord, pact: SquadPactDefinition): string {
  const weights = scoringWeightsForSquad({ weekly_pact_key: pact.key });
  return `Pact locked for ${squad.squad_name}: ${pact.label}

${pact.summary}
Scoring: ${describeScoringWeights(weights, pact.key)}

Your squad scoreboard and 3 PM nudges use this until someone sets a new pact or Sunday resets the vibe.`;
}

function describeScoringWeights(weights: SquadScoringWeights, pactKey: string | null): string {
  const parts = [`habits +${weights.habitSuccess}`];
  if (weights.studyHabitBonus > 0) {
    parts.push(`study habits +${weights.habitSuccess + weights.studyHabitBonus}`);
  }
  parts.push(`todos +${weights.todoComplete}`, `money logs +${weights.financeLog}`);
  if (!pactKey) {
    return parts.join(", ");
  }

  return `${parts.join(", ")} (${pactKey} pact)`;
}

export function buildSundayShowdownPactFooter(squad: SquadRecord): string {
  const pactLine = formatSquadPactLine(squad);
  if (pactLine) {
    return `${pactLine}\n\nNext week: squad goal study | save | hustle | balance`;
  }

  return `No pact set this week — reply squad goal study | save | hustle | balance before Monday.`;
}

export function buildSquadCreatedPactHint(archetype?: string): string {
  if (archetype?.trim()) {
    const key = suggestedPactKeyForArchetype(archetype);
    const pact = PACT_CATALOG[key];
    return `Pact auto-set for your lane: ${pact.label} (squad goal ${key}).
Change anytime: squad goal save | hustle | balance`;
  }

  return `Pick this week's pact (changes scoring):
squad goal study | save | hustle | balance`;
}

const ARCHETYPE_PACT: Record<string, SquadPactKey> = {
  "Student Grind": "study",
  "Corporate / Career": "balance",
  "Entrepreneur Mode": "hustle",
  "Life & Habit Tracking": "balance"
};

export function suggestedPactKeyForArchetype(archetype: string): SquadPactKey {
  return ARCHETYPE_PACT[archetype] ?? "balance";
}
