import type { SquadRecord } from "./squad.service.js";

export type SquadPactKey = "study" | "save" | "hustle" | "balance" | "custom";

export type SquadPactFocus = "study" | "habits" | "todos" | "money";

export interface SquadPactDefinition {
  key: Exclude<SquadPactKey, "custom">;
  label: string;
  summary: string;
}

export interface SquadScoringWeights {
  habitSuccess: number;
  studyHabitBonus: number;
  todoComplete: number;
  financeLog: number;
}

export interface SquadPactWeightsRecord extends SquadScoringWeights {
  focus?: SquadPactFocus[];
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

const PACT_CATALOG: Record<Exclude<SquadPactKey, "custom">, SquadPactDefinition> = {
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

const PACT_WEIGHTS: Record<Exclude<SquadPactKey, "custom">, SquadScoringWeights> = {
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

const FOCUS_ALIASES: Record<string, SquadPactFocus> = {
  study: "study",
  exam: "study",
  exams: "study",
  habits: "habits",
  habit: "habits",
  gym: "habits",
  todos: "todos",
  todo: "todos",
  tasks: "todos",
  task: "todos",
  money: "money",
  spend: "money",
  spending: "money",
  finance: "money",
  save: "money"
};

const CUSTOM_LABEL_MIN = 2;
const CUSTOM_LABEL_MAX = 40;

export function listSquadPactOptions(): SquadPactDefinition[] {
  return Object.values(PACT_CATALOG);
}

export function getSquadPactDefinition(key: string | null | undefined): SquadPactDefinition | null {
  if (!key || key === "custom" || !(key in PACT_CATALOG)) {
    return null;
  }

  return PACT_CATALOG[key as Exclude<SquadPactKey, "custom">];
}

export function parseSquadPactKey(value: string): Exclude<SquadPactKey, "custom"> | null {
  const normalized = value.trim().toLowerCase();
  if (normalized in PACT_CATALOG) {
    return normalized as Exclude<SquadPactKey, "custom">;
  }

  return null;
}

export function parseSquadPactFocusTokens(text: string): SquadPactFocus[] {
  const found = new Set<SquadPactFocus>();

  for (const token of text.trim().toLowerCase().split(/\s+/)) {
    const focus = FOCUS_ALIASES[token];
    if (focus) {
      found.add(focus);
    }
  }

  return [...found];
}

export function parseCustomSquadGoalBody(body: string): { label: string; focus: SquadPactFocus[] } | null {
  const focusSplit = body.split(/\s+—\s+focus\s+|\s+-\s+focus\s+|\s+focus\s+/i);
  if (focusSplit.length < 2) {
    return null;
  }

  const labelPart = focusSplit[0]?.replace(/^["']|["']$/g, "").trim() ?? "";
  const focusPart = focusSplit.slice(1).join(" ");
  if (labelPart.length < CUSTOM_LABEL_MIN || labelPart.length > CUSTOM_LABEL_MAX) {
    return null;
  }

  const focus = parseSquadPactFocusTokens(focusPart);
  if (!focus.length) {
    return null;
  }

  return { label: labelPart, focus };
}

export function buildCustomSquadWeights(focus: SquadPactFocus[]): SquadScoringWeights {
  const pools: SquadScoringWeights[] = [DEFAULT_WEIGHTS];

  if (focus.includes("study")) {
    pools.push(PACT_WEIGHTS.study);
  }
  if (focus.includes("habits")) {
    pools.push(PACT_WEIGHTS.balance);
  }
  if (focus.includes("todos")) {
    pools.push(PACT_WEIGHTS.hustle);
  }
  if (focus.includes("money")) {
    pools.push(PACT_WEIGHTS.save);
  }

  return {
    habitSuccess: Math.max(...pools.map((weights) => weights.habitSuccess)),
    studyHabitBonus: Math.max(...pools.map((weights) => weights.studyHabitBonus)),
    todoComplete: Math.max(...pools.map((weights) => weights.todoComplete)),
    financeLog: Math.max(...pools.map((weights) => weights.financeLog))
  };
}

export function buildCustomPactSummary(focus: SquadPactFocus[]): string {
  const labels: Record<SquadPactFocus, string> = {
    study: "study habits",
    habits: "general habits",
    todos: "completed tasks",
    money: "money logs"
  };

  return `Custom focus on ${focus.map((item) => labels[item]).join(" + ")}.`;
}

export function parseStoredSquadPactWeights(value: unknown): SquadPactWeightsRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const habitSuccess = Number(record.habitSuccess);
  const studyHabitBonus = Number(record.studyHabitBonus);
  const todoComplete = Number(record.todoComplete);
  const financeLog = Number(record.financeLog);

  if (
    !Number.isFinite(habitSuccess) ||
    !Number.isFinite(studyHabitBonus) ||
    !Number.isFinite(todoComplete) ||
    !Number.isFinite(financeLog)
  ) {
    return null;
  }

  const focus = Array.isArray(record.focus)
    ? record.focus
        .map((item) => String(item))
        .filter((item): item is SquadPactFocus =>
          ["study", "habits", "todos", "money"].includes(item)
        )
    : undefined;

  return {
    habitSuccess,
    studyHabitBonus,
    todoComplete,
    financeLog,
    ...(focus?.length ? { focus } : {})
  };
}

export function parseSquadGoalCommand(message: string):
  | {
      type: "show" | "clear";
    }
  | {
      type: "set";
      pactKey: Exclude<SquadPactKey, "custom">;
    }
  | {
      type: "setCustom";
      label: string;
      focus: SquadPactFocus[];
    }
  | null {
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

  const customMatch = message.trim().match(/^(?:set\s+)?squad\s+(?:goal|pact)\s+custom\s+(.+)$/i);
  if (customMatch?.[1]) {
    const parsed = parseCustomSquadGoalBody(customMatch[1]);
    if (!parsed) {
      return { type: "show" };
    }

    return {
      type: "setCustom",
      label: parsed.label,
      focus: parsed.focus
    };
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

export function scoringWeightsForSquad(
  squad: Pick<SquadRecord, "weekly_pact_key" | "weekly_pact_weights">
): SquadScoringWeights {
  if (squad.weekly_pact_key === "custom") {
    const stored = parseStoredSquadPactWeights(squad.weekly_pact_weights);
    if (stored) {
      return stored;
    }

    return DEFAULT_WEIGHTS;
  }

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

export function formatSquadPactLine(
  squad: Pick<SquadRecord, "weekly_pact_key" | "weekly_pact_label" | "weekly_pact_weights">
): string | null {
  if (squad.weekly_pact_key === "custom") {
    const label = squad.weekly_pact_label?.trim() || "Custom pact";
    const stored = parseStoredSquadPactWeights(squad.weekly_pact_weights);
    const summary = stored?.focus?.length ? buildCustomPactSummary(stored.focus) : "Custom scoring for your squad.";
    return `This week's pact: ${label} — ${summary}`;
  }

  const pact = getSquadPactDefinition(squad.weekly_pact_key);
  if (!pact) {
    return null;
  }

  const label = squad.weekly_pact_label?.trim() || pact.label;
  return `This week's pact: ${label} — ${pact.summary}`;
}

export function buildSquadGoalOptionsText(): string {
  return `${listSquadPactOptions()
    .map((pact) => `${pact.key} — ${pact.label}`)
    .join("\n")}
custom — your own label + focus (see below)`;
}

export function buildCustomSquadGoalHelpText(): string {
  return `Custom pact format:
squad goal custom Exam cram — focus study todos
squad goal custom Gym January — focus habits
squad goal custom No takeaway week — focus money

Focus keywords: study, habits, todos, money (combine any that fit).`;
}

export function buildSquadGoalShowReply(squad: SquadRecord): string {
  const pactLine = formatSquadPactLine(squad);
  if (!pactLine) {
    return `No squad pact set for ${squad.squad_name} yet.

Pick one for this week:
${buildSquadGoalOptionsText()}

${buildCustomSquadGoalHelpText()}

Reply: squad goal study | save | hustle | balance`;
  }

  const weights = scoringWeightsForSquad(squad);
  const weightLine = describeScoringWeights(weights, squad.weekly_pact_key);

  return `${pactLine}

Scoring this week: ${weightLine}

Change it anytime:
squad goal study | save | hustle | balance
${buildCustomSquadGoalHelpText()}
squad goal clear — back to default scoring`;
}

export function buildSquadGoalSetReply(squad: SquadRecord, pact: SquadPactDefinition): string {
  const weights = scoringWeightsForSquad({ weekly_pact_key: pact.key, weekly_pact_weights: null });
  return `Pact locked for ${squad.squad_name}: ${pact.label}

${pact.summary}
Scoring: ${describeScoringWeights(weights, pact.key)}

Your squad scoreboard and 3 PM nudges use this until someone sets a new pact or Sunday resets the vibe.`;
}

export function buildCustomSquadGoalSetReply(squad: SquadRecord, input: {
  label: string;
  focus: SquadPactFocus[];
  weights: SquadScoringWeights;
}): string {
  return `Custom pact locked for ${squad.squad_name}: ${input.label}

${buildCustomPactSummary(input.focus)}
Scoring: ${describeScoringWeights(input.weights, "custom")}

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
    return `${pactLine}\n\nNext week: squad goal study | save | hustle | balance — or squad goal custom Your theme — focus study habits todos money`;
  }

  return `No pact set this week — reply squad goal study | save | hustle | balance before Monday, or set a custom pact.`;
}

export function buildSquadCreatedPactHint(archetype?: string): string {
  if (archetype?.trim()) {
    const key = suggestedPactKeyForArchetype(archetype);
    const pact = PACT_CATALOG[key];
    return `Pact auto-set for your lane: ${pact.label} (squad goal ${key}).
Change anytime: squad goal save | hustle | balance | custom`;
  }

  return `Pick this week's pact (changes scoring):
squad goal study | save | hustle | balance
squad goal custom Your theme — focus study habits todos money`;
}

const ARCHETYPE_PACT: Record<string, Exclude<SquadPactKey, "custom">> = {
  "Student Grind": "study",
  "Corporate / Career": "balance",
  "Entrepreneur Mode": "hustle",
  "Life & Habit Tracking": "balance"
};

export function suggestedPactKeyForArchetype(archetype: string): Exclude<SquadPactKey, "custom"> {
  return ARCHETYPE_PACT[archetype] ?? "balance";
}
