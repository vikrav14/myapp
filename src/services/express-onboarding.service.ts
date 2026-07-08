import type { MauriArchetype, MauriModuleKey, MauriUser, MorningBriefTopicKey, UserMindFact } from "../types.js";
import { MODULE_CATALOG } from "./user-modules.constants.js";
import { defaultTopicsForArchetype, formatTopicList } from "./morning-brief-topics.service.js";
import { formatModuleLabels, suggestModulesFromFacts } from "./user-modules.service.js";
import {
  combinedFactBlob,
  hasBoundaryGoal,
  hasFamilyMoneyPressure,
  hasPrivateFinanceSignal,
  isRemoteWorkerProfile,
  isRetiredOrElderProfile
} from "./profile-inference.service.js";
import { generateExpressSetupQuestionReply } from "./ai.service.js";
import { formatUserMindForPrompt } from "./user-mind.service.js";
import { logger } from "../lib/logger.js";

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

export const POST_ACTIVATION_QUIET_WINDOW_MINUTES = 15;

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

export {
  combinedFactBlob,
  hasBoundaryGoal,
  hasFamilyMoneyPressure,
  hasPrivateFinanceSignal,
  isRemoteWorkerProfile,
  isRetiredOrElderProfile
} from "./profile-inference.service.js";

export function isExpressCardEchoMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 40) {
    return false;
  }

  const markers = [
    "ready when you are",
    "one tap starts your 7-day trial",
    "here's what i'll set up",
    "morning pulse:",
    "also watching:",
    "tags:",
    "tap start my trial below",
    "you're in,",
    "your 7-day trial starts now",
    "what makes mauri different",
    "for advice i'll lean into",
    "brain dump, remind me, help"
  ];

  const hits = markers.filter((marker) => normalized.includes(marker)).length;
  return hits >= 2 || (hits >= 1 && normalized.length > 160);
}

export function shouldSuppressPostActivationNoise(user: MauriUser, message: string): boolean {
  if (user.onboarding_state !== "active" || !user.onboarding_completed_at) {
    return false;
  }

  const minutesSince =
    (Date.now() - new Date(user.onboarding_completed_at).getTime()) / (60 * 1000);
  if (minutesSince > POST_ACTIVATION_QUIET_WINDOW_MINUTES) {
    return false;
  }

  return isExpressStartConfirmation(message) || isExpressCardEchoMessage(message);
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
      /\b(finance|corporate|office|job|salary|commute|manager|tech lead|developer|dev|remote|employed|analyst|accountant|ébène|ebene|cybercity|work in|eu company)\b/.test(
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

    if (/\b(retired|pension|widow|widower|grandmother|grandfather|grandma|grandpa)\b/.test(blob)) {
      scores["Life & Habit Tracking"] += 2;
    }

    if (/\b(habit|routine|balance|wellness|mood|gym|carer|caregiver|primary carer|running on empty|no sleep|exhausted)\b/.test(blob)) {
      scores["Life & Habit Tracking"] += 1;
    }

    if (/\b(freelance|gig|driving for|logo design|airport transfer|side hustle|three jobs|multiple jobs)\b/.test(blob)) {
      scores["Entrepreneur Mode"] += 1;
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
  const elder = isRetiredOrElderProfile(facts);
  const privateFinance = hasPrivateFinanceSignal(facts);

  if (elder && privateFinance) {
    return "quiet money + local life";
  }

  if (elder) {
    return "local life + calm routines";
  }

  const remote = isRemoteWorkerProfile(facts);
  const familyMoney = hasFamilyMoneyPressure(facts);

  if (remote && familyMoney) {
    return "remote work + money pressure";
  }

  if (remote) {
    return "remote work + money + focus";
  }

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

function inferTopicsFromFacts(facts: UserMindFact[], archetype: MauriArchetype): MorningBriefTopicKey[] {
  if (isRetiredOrElderProfile(facts)) {
    return ["LocalBuzz", "Money", "Traffic"];
  }

  if (isRemoteWorkerProfile(facts)) {
    return ["Tech", "Money", "LocalBuzz"];
  }

  if (hasPrivateFinanceSignal(facts)) {
    const base = defaultTopicsForArchetype(archetype);
    return base.map((topic) => (topic === "Entertainment" ? "Traffic" : topic));
  }

  return defaultTopicsForArchetype(archetype);
}

export function inferExpressSetup(facts: UserMindFact[]): ExpressOnboardingSetup {
  const archetype = inferArchetypeFromFacts(facts);
  const modules = suggestModulesFromFacts(facts, archetype);
  const topics = inferTopicsFromFacts(facts, archetype);

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

Here's what makes Mauri different: the more I know you, the sharper I get on *your* next step — habits, money, hard calls in plain language, not generic bot advice. Personal stuff stays private (never in your 7am pulse). We build the rest together, week by week — that's the relationship other apps don't offer.

Tap Start my trial below — or reply start.`;
}

export function buildExpressActivationReply(input: {
  firstName?: string | null;
  setup: ExpressOnboardingSetup;
  weeklyFocus: string;
  facts?: UserMindFact[];
}): string {
  const name = input.firstName?.trim() || "there";
  const facts = input.facts ?? [];
  const privateFinance = hasPrivateFinanceSignal(facts);
  const watching =
    input.setup.modules.length > 0
      ? `Also watching: ${formatModuleLabels(input.setup.modules)}.`
      : "Add extra tools anytime — e.g. add career / add habits.";

  const lines = [`You're in, ${name} ✌️`, ""];

  if (privateFinance) {
    lines.push(
      "Your private money notes stay between us — nothing surfaces in your 7am pulse or anywhere else.",
      ""
    );
  }

  lines.push(
    `Your 7am pulse will lean into ${input.setup.morningPulseLabel} — personal stuff stays out of that.`,
    watching,
    "",
    "Your 7-day trial starts now.",
    `Morning brief tags: ${formatTopicList(input.setup.topics)} — first brief tomorrow at 7:00.`,
    `This week's habit: ${input.weeklyFocus}`,
    "",
    "Brain dump, remind me, help — all live now. The more we talk, the better I get at what's next for *you*. I'll check in gently on the live stuff."
  );

  return lines.join("\n");
}

export function isExpressStartConfirmation(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return START_CONFIRMATIONS.has(normalized);
}

const EXPRESS_SETUP_QUESTION_PATTERN =
  /\b(how (did|do) you (know|choose|pick|decide)|why (these|this|that|did you)|what does .* mean|how come|explain|what are (these|the) tags|choose this for me|do you even know|what is this|makes no sense|sounds weird|why habits|why founder|why money|why localbuzz)\b/i;

export function isExpressSetupQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 8) {
    return false;
  }

  if (trimmed.endsWith("?")) {
    return true;
  }

  return EXPRESS_SETUP_QUESTION_PATTERN.test(trimmed);
}

function factsMatching(facts: UserMindFact[], pattern: RegExp): string[] {
  return facts
    .filter((fact) => pattern.test(factBlob(fact)))
    .map((fact) => fact.fact_value)
    .slice(0, 2);
}

function explainMorningPulseReason(setup: ExpressOnboardingSetup, facts: UserMindFact[]): string {
  const heavy = factsMatching(facts, /\b(stress|sleep|empty|burnout|overwhelm|panic|maxed|debt|rent|loan)\b/i);
  const work = factsMatching(facts, /\b(job|work|freelance|gig|commute|finance|transfer|design)\b/i);
  const bits = [`I read your life as "${setup.morningPulseLabel}" for the 7am brief only — practical pulse, not the heavy personal stuff.`];

  if (work.length > 0) {
    bits.push(`Work side: ${work[0]}.`);
  }

  if (heavy.length > 0) {
    bits.push(`You're under load (${heavy[0]}) — brief stays useful, not another guilt trip.`);
  }

  return bits.join(" ");
}

function explainModuleReason(module: MauriModuleKey, facts: UserMindFact[], archetype: MauriArchetype): string {
  const label = MODULE_CATALOG[module].shortLabel;

  if (module === "habits") {
    const heavy = factsMatching(facts, /\b(stress|sleep|empty|burnout|overwhelm|habit|routine|balance)\b/i);
    return heavy.length > 0
      ? `${label}: you flagged running on empty / stress — gentle routine check-ins, not lectures. (${heavy[0]})`
      : `${label}: balance and routines without the guilt-trip stuff.`;
  }

  if (module === "founder") {
    const hustle = factsMatching(facts, /\b(freelance|logo|transfer|side hustle|gig|business|startup|founder)\b/i);
    return hustle.length > 0
      ? `${label}: picked up side-hustle energy (${hustle[0]}) — cashflow + focus blocks behind the scenes.`
      : `${label}: side projects and hustle tools if you're building on the side.`;
  }

  if (module === "career") {
    return `${label}: job + money runway tools — payday check-ins, work blocks. Fits ${archetype.toLowerCase()}.`;
  }

  return `${label}: ${MODULE_CATALOG[module].description}.`;
}

function explainTopicReason(topic: MorningBriefTopicKey, facts: UserMindFact[], archetype: MauriArchetype): string {
  if (topic === "Money") {
    const money = factsMatching(facts, /\b(money|mcb|credit|debt|rent|loan|maxed|pay|salary|save)\b/i);
    return money.length > 0
      ? `#Money — you mentioned money pressure (${money[0]}). Brief pulls finance-relevant local stories.`
      : `#Money — default for ${archetype}; keeps salary/rent/cost-of-life stuff in the brief.`;
  }

  if (topic === "Traffic") {
    const commute = factsMatching(facts, /\b(commute|traffic|drive|hours in|road)\b/i);
    return commute.length > 0
      ? `#Traffic — commute showed up (${commute[0]}).`
      : `#Traffic — Mauritius commute chaos; useful if you're moving daily.`;
  }

  if (topic === "LocalBuzz") {
    const local = factsMatching(facts, /\b(triolet|mauritius|local|island|town|village|area)\b/i);
    return local.length > 0
      ? `#LocalBuzz — local context for where you are (${local[0]}).`
      : `#LocalBuzz — what's happening around Mauritius that morning.`;
  }

  if (topic === "Tech") {
    return `#Tech — work/tech angle in the brief. Swap anytime.`;
  }

  return `#${topic} — rounds out the brief vibe; change with update topics anytime.`;
}

export function buildExpressSetupRationale(facts: UserMindFact[], setup: ExpressOnboardingSetup): string {
  const lines = [
    explainMorningPulseReason(setup, facts),
    ...setup.modules.map((module) => explainModuleReason(module, facts, setup.archetype)),
    ...setup.topics.map((topic) => explainTopicReason(topic, facts, setup.archetype))
  ];

  return lines.join("\n");
}

export function buildExpressSetupQuestionReplyTemplate(input: {
  firstName?: string | null;
  setup: ExpressOnboardingSetup;
  facts: UserMindFact[];
}): string {
  const name = input.firstName?.trim() || "there";
  const rationale = buildExpressSetupRationale(input.facts, input.setup);

  return `Fair question, ${name} — nothing here is random. I built it from what you told me:

${rationale}

Nothing's locked in. Tell me what to swap, or tap Start my trial when it feels right.`;
}

export async function resolveExpressSetupQuestionReply(input: {
  userId: string;
  firstName?: string | null;
  message: string;
  facts: UserMindFact[];
  setup: ExpressOnboardingSetup;
}): Promise<string> {
  const name = input.firstName?.trim() || "there";
  const factsSummary = formatUserMindForPrompt(input.facts);
  const rationale = buildExpressSetupRationale(input.facts, input.setup);

  try {
    return await generateExpressSetupQuestionReply({
      firstName: name,
      message: input.message,
      factsSummary,
      setupLine: `Morning pulse: ${input.setup.morningPulseLabel}; watching: ${formatModuleLabels(input.setup.modules)}; tags: ${formatTopicList(input.setup.topics)}`,
      rationale
    });
  } catch (error) {
    logger.warn({ error, userId: input.userId }, "Express setup question AI reply failed; using template.");
    return buildExpressSetupQuestionReplyTemplate({
      firstName: input.firstName ?? null,
      setup: input.setup,
      facts: input.facts
    });
  }
}
