import type { UserMindSnapshotPayload } from "../schemas/user-mind.js";
import type { MauriUser, UserMindFact } from "../types.js";
import { formatHelpFocusLabel, formatHelpFocusUserLens } from "./help-focus-inference.service.js";
import { getUserMindSnapshot } from "./user-mind-snapshot.service.js";
import { loadUserMindFacts } from "./user-mind.service.js";

const FACT_CATEGORY_ORDER = [
  "identity",
  "location",
  "life_context",
  "goals",
  "stressors",
  "relationships",
  "interests",
  "preferences",
  "boundaries",
  "user_stated"
] as const;

const FACT_CATEGORY_LABELS: Record<string, string> = {
  identity: "Identity",
  location: "Where you're based",
  life_context: "Life & work",
  interests: "Interests",
  goals: "Goals",
  stressors: "What's heavy",
  preferences: "How to show up",
  boundaries: "Boundaries",
  relationships: "People",
  user_stated: "You told me"
};

const MAX_ITEMS_PER_SECTION = 6;
const MAX_OPEN_LOOPS = 4;

export interface MauriMemoryProfileSection {
  key: string;
  label: string;
  items: string[];
  overflowCount: number;
}

export interface MauriMemoryStrategyTrack {
  laneLabels: string;
  howIHelp: string;
}

export interface MauriMemoryView {
  activeFocus: string | null;
  openLoops: string[];
  strategyTrack: MauriMemoryStrategyTrack | null;
  thisWeekFocus: string | null;
  profileSections: MauriMemoryProfileSection[];
  snapshotRefreshedAt: string | null;
  factCount: number;
  isSparse: boolean;
}

function formatFactLine(fact: UserMindFact): string {
  if (fact.category === "identity" && fact.fact_key === "preferred_name") {
    return `Call you: ${fact.fact_value}`;
  }

  return fact.fact_value;
}

function groupFactsForView(facts: UserMindFact[]): MauriMemoryProfileSection[] {
  const grouped = new Map<string, UserMindFact[]>();

  for (const fact of facts) {
    if (!fact.user_visible) {
      continue;
    }

    const bucket = grouped.get(fact.category) ?? [];
    bucket.push(fact);
    grouped.set(fact.category, bucket);
  }

  const sections: MauriMemoryProfileSection[] = [];

  for (const key of FACT_CATEGORY_ORDER) {
    const categoryFacts = grouped.get(key);
    if (!categoryFacts?.length) {
      continue;
    }

    const items = categoryFacts.map(formatFactLine);
    const visible = items.slice(0, MAX_ITEMS_PER_SECTION);
    const overflowCount = Math.max(0, items.length - MAX_ITEMS_PER_SECTION);

    sections.push({
      key,
      label: FACT_CATEGORY_LABELS[key] ?? key,
      items: visible,
      overflowCount
    });
  }

  return sections;
}

function synthesizeActiveFocusFromFacts(facts: UserMindFact[]): string | null {
  const goals = facts.filter((fact) => fact.category === "goals").map((fact) => fact.fact_value);
  const stressors = facts
    .filter((fact) => fact.category === "stressors")
    .map((fact) => fact.fact_value);

  const parts: string[] = [];

  if (stressors.length > 0) {
    parts.push(stressors.slice(0, 2).join("; "));
  }

  if (goals.length > 0) {
    parts.push(`Aiming for: ${goals.slice(0, 2).join("; ")}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(". ");
}

export function buildStrategyTrackForUser(user: MauriUser): MauriMemoryStrategyTrack | null {
  if (!user.help_focus_primary) {
    return null;
  }

  const laneLabels =
    user.help_focus_secondary && user.help_focus_secondary !== user.help_focus_primary
      ? `${formatHelpFocusLabel(user.help_focus_primary)} + ${formatHelpFocusLabel(user.help_focus_secondary)}`
      : formatHelpFocusLabel(user.help_focus_primary);

  const lenses = [
    formatHelpFocusUserLens(user.help_focus_primary),
    user.help_focus_secondary ? formatHelpFocusUserLens(user.help_focus_secondary) : null
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    laneLabels,
    howIHelp: lenses || "One practical next step at a time."
  };
}

export function buildMauriMemoryViewFromData(input: {
  user: MauriUser;
  facts: UserMindFact[];
  snapshot?: UserMindSnapshotPayload | null;
  snapshotRefreshedAt?: string | null;
}): MauriMemoryView {
  const { user, facts } = input;
  const snapshot = input.snapshot ?? null;

  const strategyTrack = buildStrategyTrackForUser(user);
  const thisWeekFocus = user.weekly_focus_habit?.trim() || null;
  const profileSections = groupFactsForView(facts);

  const isSparse =
    facts.length === 0 && !snapshot && !strategyTrack && !thisWeekFocus;

  const activeFocus = isSparse
    ? null
    : snapshot?.life_summary?.trim() ||
      synthesizeActiveFocusFromFacts(facts) ||
      thisWeekFocus ||
      null;

  const openLoops =
    snapshot?.open_loops
      ?.map((loop) => loop.trim())
      .filter((loop) => loop.length > 0)
      .slice(0, MAX_OPEN_LOOPS) ?? [];

  return {
    activeFocus,
    openLoops,
    strategyTrack,
    thisWeekFocus,
    profileSections,
    snapshotRefreshedAt: input.snapshotRefreshedAt ?? null,
    factCount: facts.length,
    isSparse
  };
}

export async function loadMauriMemoryView(user: MauriUser): Promise<MauriMemoryView> {
  const [facts, mindRecord] = await Promise.all([
    loadUserMindFacts(user.id),
    getUserMindSnapshot(user.id)
  ]);

  return buildMauriMemoryViewFromData({
    user,
    facts,
    snapshot: mindRecord?.snapshot ?? null,
    snapshotRefreshedAt: mindRecord?.generated_at ?? null
  });
}

function formatRefreshedLine(generatedAt: string | null): string | null {
  if (!generatedAt) {
    return null;
  }

  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatted = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Indian/Mauritius"
  });

  return `Reflection refreshed: ${formatted} (nightly)`;
}

export function formatMemorySectionHeader(emoji: string, title: string): string {
  return `${emoji} ${title}`;
}

export function formatStrategyTrackBlock(track: MauriMemoryStrategyTrack): string[] {
  return [
    formatMemorySectionHeader("🛡️", "Strategy track"),
    track.laneLabels,
    `How I help: ${track.howIHelp}`,
    "Reply my playbook to see what's behind this lane."
  ];
}

export function formatMauriMemoryViewForWhatsApp(user: MauriUser, view: MauriMemoryView): string {
  const name = user.first_name?.trim() || "there";
  const lines: string[] = [];

  if (view.isSparse) {
    return `${name} — I'm still building your structured profile.

Tell me in chat — or reply remember that I live in Quatre Bornes / I hate guilt trips / I'm balancing shop and baby.

Once I have enough, this view shows:
🧠 Active focus · 🛡️ Strategy track · 📋 What you told me · 🔒 Your data`;
  }

  lines.push(`${name} — here's your Mauri Memory (structured profile — not chat guesswork):`);
  lines.push("");

  lines.push(formatMemorySectionHeader("🧠", "Active focus"));
  if (view.activeFocus) {
    lines.push(view.activeFocus);
  } else {
    lines.push("Still forming — share more in chat or set my focus for this week.");
  }

  if (view.openLoops.length > 0) {
    lines.push(`Open loops: ${view.openLoops.join("; ")}`);
  }

  lines.push("");

  if (view.strategyTrack) {
    lines.push(...formatStrategyTrackBlock(view.strategyTrack));
    lines.push("");
  }

  if (view.thisWeekFocus && view.thisWeekFocus !== view.activeFocus) {
    lines.push(formatMemorySectionHeader("🎯", "This week's focus"));
    lines.push(view.thisWeekFocus);
    lines.push("");
  }

  if (view.profileSections.length > 0) {
    lines.push(formatMemorySectionHeader("📋", "What you told me"));
    for (const section of view.profileSections) {
      lines.push(`${section.label}:`);
      for (const item of section.items) {
        lines.push(`- ${item}`);
      }
      if (section.overflowCount > 0) {
        lines.push(`- …and ${section.overflowCount} more`);
      }
    }
    lines.push("");
  }

  lines.push(formatMemorySectionHeader("🔒", "Your data"));
  lines.push("Private to you — never mixed into other users' advice.");
  lines.push("Raw vents stay out of this view and your Sunday report.");
  lines.push("Wrong or outdated? forget that … or remember that …");
  lines.push("");

  const refreshed = formatRefreshedLine(view.snapshotRefreshedAt);
  if (refreshed) {
    lines.push(refreshed);
  } else if (view.factCount > 0) {
    lines.push("Facts update when you share or reply remember that …");
  }

  return lines.join("\n").trim();
}

export function formatStrategyTrackReplyForUser(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";
  const track = buildStrategyTrackForUser(user);

  if (!track) {
    return `${name} — pick what you want me to help with most. Tap the list below or reply help focus anytime.`;
  }

  const block = formatStrategyTrackBlock(track);

  return [`${name} — ${block[0]}`, block[1], block[2], block[3] ?? "", "", "Reply help focus to change lane."].join("\n");
}
