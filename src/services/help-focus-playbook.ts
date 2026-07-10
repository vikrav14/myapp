import type { HelpFocusKey } from "./help-focus.constants.js";

export interface HelpFocusPlaybookItem {
  outcome: string;
  source: string;
}

export interface HelpFocusPlaybookLane {
  whatToExpect: string;
  items: HelpFocusPlaybookItem[];
}

/** Outcome-first playbook copy — books are credentials, not the headline. */
export const HELP_FOCUS_PLAYBOOK: Record<HelpFocusKey, HelpFocusPlaybookLane> = {
  productivity: {
    whatToExpect: "One protected focus block and smaller reps that survive tired evenings.",
    items: [
      { outcome: "Environment beats willpower", source: "Atomic Habits" },
      { outcome: "One deep block beats ten shallow tasks", source: "Deep Work" },
      { outcome: "One priority at a time", source: "The One Thing" }
    ]
  },
  personal_finance: {
    whatToExpect: "One runway number you can hold before payday — not spreadsheet guilt.",
    items: [
      { outcome: "Runway clarity without shame", source: "Psychology of Money" },
      { outcome: "Save-first before lifestyle creep", source: "The Richest Man in Babylon" },
      { outcome: "Cashflow lens for rent and side hustle", source: "Cashflow thinking" }
    ]
  },
  business: {
    whatToExpect: "Systems and cashflow moves that fit shop reality — not hero-mode burnout.",
    items: [
      { outcome: "Work on the business, not just in it", source: "The E-Myth Revisited" },
      { outcome: "Traction over busywork", source: "Traction" },
      { outcome: "Small bets before big leaps", source: "Lean Startup" }
    ]
  },
  self_help: {
    whatToExpect: "Small proof you can point to — not another pep talk.",
    items: [
      { outcome: "Identity from action, not affirmations", source: "Mindset" },
      { outcome: "Self-image that matches your next step", source: "Psycho-Cybernetics" },
      { outcome: "Responsibility without self-attack", source: "The Subtle Art of Not Giving a F*ck" }
    ]
  },
  critical_thinking: {
    whatToExpect: "Clearer calls on the big decisions — less WhatsApp-forward panic.",
    items: [
      { outcome: "Slow thinking on high-stakes choices", source: "Thinking, Fast and Slow" },
      { outcome: "Plan for shocks, not just best case", source: "The Black Swan" },
      { outcome: "Gain from disorder where you can", source: "Antifragile" }
    ]
  },
  relationship: {
    whatToExpect: "Boundary scripts and secure-base moves — not guilt-trip diplomacy.",
    items: [
      { outcome: "Attachment patterns before blame", source: "Attached" },
      { outcome: "Speak love in a language they hear", source: "The 5 Love Languages" },
      { outcome: "Safety before hard truth", source: "Nonviolent Communication" }
    ]
  },
  human_behavior: {
    whatToExpect: "Read the room and protect your reputation on a small island.",
    items: [
      { outcome: "Incentives and ego before reacting", source: "Influence" },
      { outcome: "Leverage without burning bridges", source: "The 48 Laws of Power" },
      { outcome: "Spot games people play early", source: "Games People Play" }
    ]
  },
  philosophy: {
    whatToExpect: "Calm in what you can control — meaning in small daily choices.",
    items: [
      { outcome: "Control the controllable", source: "Stoicism (Meditations)" },
      { outcome: "Meaning under pressure", source: "Man's Search for Meaning" },
      { outcome: "Virtue in the next ten minutes", source: "Seneca / Epictetus" }
    ]
  },
  discipline: {
    whatToExpect: "Own the next ten minutes — follow-through without bootcamp abuse.",
    items: [
      { outcome: "Callous the mind on small reps", source: "Can't Hurt Me" },
      { outcome: "Extreme ownership of the next move", source: "Extreme Ownership" },
      { outcome: "The obstacle as the way", source: "The Obstacle Is the Way" }
    ]
  },
  communication: {
    whatToExpect: "One clear ask in a hard talk — calibrated for Mauritian high-context culture.",
    items: [
      { outcome: "Safety then truth in confrontation", source: "Crucial Conversations" },
      { outcome: "Tactical empathy in negotiation", source: "Never Split the Difference" },
      { outcome: "Boundaries without scorched earth", source: "Difficult Conversations" }
    ]
  },
  health: {
    whatToExpect: "Sleep, movement, stress basics — never diagnosing, GP for symptoms.",
    items: [
      { outcome: "Sleep as the first lever", source: "Why We Sleep" },
      { outcome: "Movement that fits real schedules", source: "Sleep–movement–stress triangle" },
      { outcome: "Stress load before burnout stories", source: "Recovery basics" }
    ]
  },
  career: {
    whatToExpect: "Skills and proof before a big leap — reputation on a small island.",
    items: [
      { outcome: "Career capital before passion leaps", source: "So Good They Can't Ignore You" },
      { outcome: "Marketable proof, not vague ambition", source: "What Color Is Your Parachute?" },
      { outcome: "Reputation-aware pivots", source: "Ébène / contract reality" }
    ]
  },
  parenting: {
    whatToExpect: "Connection before correction — scripts that fit tuition and carer load.",
    items: [
      { outcome: "Listen so they will talk", source: "How to Talk So Kids Will Listen" },
      { outcome: "Gentle firmness without guilt", source: "Gentle parenting" },
      { outcome: "Connection before correction", source: "Connection before correction" }
    ]
  },
  psychology: {
    whatToExpect: "Name the pattern behind the spiral — small resets, not therapy cosplay.",
    items: [
      { outcome: "Thought traps you can interrupt", source: "Feeling Good (CBT)" },
      { outcome: "Body-stored stress without labels", source: "The Body Keeps the Score" },
      { outcome: "Emotional literacy in plain language", source: "Emotional Intelligence" }
    ]
  },
  art: {
    whatToExpect: "Ship small creative reps — beat resistance alongside real life.",
    items: [
      { outcome: "Resistance is normal — ship anyway", source: "The War of Art" },
      { outcome: "Ritual beats waiting for the muse", source: "The Artist's Way" },
      { outcome: "Steal, remix, protect the craft", source: "Steal Like an Artist" }
    ]
  }
};

export function formatPlaybookLaneSection(input: {
  label: string;
  roleSuffix: string;
  playbook: HelpFocusPlaybookLane;
}): string {
  const lines = input.playbook.items.map(
    (item) => `• ${item.outcome} — *${item.source}* thinking`
  );

  return [
    `*${input.label}${input.roleSuffix}*`,
    ...lines,
    "",
    `What to expect: ${input.playbook.whatToExpect}`
  ].join("\n");
}
