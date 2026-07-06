import type { MauriArchetype, MauriModuleKey, MorningBriefTopicKey, UserMindFact } from "../types.js";
import { defaultTopicsForArchetype, formatTopicList } from "./morning-brief-topics.service.js";
import { formatModuleLabels, suggestModulesFromFacts } from "./user-modules.service.js";

export interface ExpressOnboardingSetup {
  archetype: MauriArchetype;
  modules: MauriModuleKey[];
  topics: MorningBriefTopicKey[];
  morningPulseLabel: string;
}

const MORNING_PULSE_LABELS: Record<MauriArchetype, string> = {
  "Corporate / Career": "commute + money + work",
  "Student Grind": "exams + commute + student spend",
  "Entrepreneur Mode": "cashflow + hustle + focus",
  "Life & Habit Tracking": "balance + routines + local life",
  Custom: "your mix — tuned from what you shared"
};

const START_CONFIRMATIONS = new Set([
  "start",
  "start trial",
  "start my trial",
  "yes",
  "yep",
  "ok",
  "okay",
  "go",
  "lets go",
  "let's go",
  "confirm",
  "👍",
  "✅"
]);

function factBlob(fact: UserMindFact): string {
  return `${fact.fact_key} ${fact.fact_value}`.toLowerCase();
}

function isDependentContext(blob: string): boolean {
  return /\b(daughter|son|child|kid|saving for|their uni|their university|her uni|his uni)\b/.test(blob);
}

export function inferArchetypeFromFacts(facts: UserMindFact[]): MauriArchetype {
  const scores: Record<Exclude<MauriArchetype, "Custom">, number> = {
    "Corporate / Career": 0,
    "Student Grind": 0,
    "Entrepreneur Mode": 0,
    "Life & Habit Tracking": 0
  };

  for (const fact of facts) {
    const blob = factBlob(fact);

    if (
      /\b(finance|corporate|office|job|salary|commute|manager|tech lead|developer|employed|analyst|accountant|ébène|ebene|cybercity|work in)\b/.test(
        blob
      )
    ) {
      scores["Corporate / Career"] += 2;
    }

    if (
      !isDependentContext(blob) &&
      /\b(i'm a student|i am a student|student at|studying|final year|my exams|uom|utm)\b/.test(blob)
    ) {
      scores["Student Grind"] += 2;
    }

    if (/\b(entrepreneur|startup|founder|side hustle|side app|business owner|printing shop|retail shop|shop owner|running a shop)\b/.test(blob)) {
      scores["Entrepreneur Mode"] += 2;
    }

    if (/\b(habit|routine|balance|wellness|mood|gym|carer|caregiver|primary carer)\b/.test(blob)) {
      scores["Life & Habit Tracking"] += 1;
    }
  }

  const ranked = (Object.entries(scores) as Array<[MauriArchetype, number]>).sort(
    (left, right) => right[1] - left[1]
  );
  const top = ranked[0];

  if (!top || top[1] === 0) {
    return "Life & Habit Tracking";
  }

  return top[0];
}

export function buildMorningPulseLabel(archetype: MauriArchetype, facts: UserMindFact[]): string {
  const base = MORNING_PULSE_LABELS[archetype] ?? MORNING_PULSE_LABELS["Life & Habit Tracking"];
  const hasMoneyPressure = facts.some((fact) => {
    const blob = factBlob(fact);
    return /\b(rent|loan|runway|payday|contractor|quotes|saving|leak|panic|debt|afford)\b/.test(blob);
  });
  const hasCommute = facts.some((fact) => /\b(commute|traffic|hours in traffic|flic-en-flac|flac)\b/.test(factBlob(fact)));

  if (archetype === "Corporate / Career" && hasMoneyPressure && hasCommute) {
    return "commute + money pressure + work";
  }

  if (archetype === "Corporate / Career" && hasMoneyPressure) {
    return "money pressure + work + commute";
  }

  return base;
}

export function inferExpressSetup(facts: UserMindFact[]): ExpressOnboardingSetup {
  const archetype = inferArchetypeFromFacts(facts);
  const modules = suggestModulesFromFacts(facts, archetype);
  const topics = defaultTopicsForArchetype(archetype);

  return {
    archetype,
    modules,
    topics,
    morningPulseLabel: buildMorningPulseLabel(archetype, facts)
  };
}

export function buildExpressStartSummary(input: {
  firstName?: string | null;
  setup: ExpressOnboardingSetup;
}): string {
  const name = input.firstName?.trim() || "there";
  const watching =
    input.setup.modules.length > 0
      ? formatModuleLabels(input.setup.modules)
      : "brief only — add tools anytime";

  return `${name} — here's what I'll set up for you:

🌅 Morning pulse: ${input.setup.morningPulseLabel}
🔧 Also watching: ${watching}
📰 Tags: ${formatTopicList(input.setup.topics)}

Personal stuff stays separate. Tune anytime with my lane or help.

Tap Start my trial below — or reply start.`;
}

export function buildExpressActivationReply(input: {
  firstName?: string | null;
  setup: ExpressOnboardingSetup;
  weeklyFocus: string;
}): string {
  const name = input.firstName?.trim() || "there";
  const watching =
    input.setup.modules.length > 0
      ? `Also watching: ${formatModuleLabels(input.setup.modules)}.`
      : "Add extra tools anytime — e.g. add habits / add career.";

  return [
    `You're in, ${name} ✌️`,
    "",
    `Your 7am pulse will lean into ${input.setup.morningPulseLabel} — personal stuff stays out of that.`,
    watching,
    "",
    "Your 7-day trial starts now.",
    `Morning brief tags: ${formatTopicList(input.setup.topics)} — first brief tomorrow at 7:00.`,
    `This week's habit: ${input.weeklyFocus}`,
    "",
    "Brain dump, remind me, help — all work now. I'll check in gently on the live stuff."
  ].join("\n");
}

export function isExpressStartConfirmation(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return START_CONFIRMATIONS.has(normalized);
}
