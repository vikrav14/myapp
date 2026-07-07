export const HELP_FOCUS_KEYS = [
  "productivity",
  "personal_finance",
  "business",
  "self_help",
  "critical_thinking",
  "relationship",
  "human_behavior",
  "philosophy",
  "discipline",
  "communication",
  "health",
  "career",
  "parenting"
] as const;

export type HelpFocusKey = (typeof HELP_FOCUS_KEYS)[number];

export interface HelpFocusCatalogEntry {
  key: HelpFocusKey;
  label: string;
  description: string;
  enginePrompt: string;
}

export const HELP_FOCUS_CATALOG: HelpFocusCatalogEntry[] = [
  {
    key: "productivity",
    label: "Productivity",
    description: "Focus, habits, deep work",
    enginePrompt:
      "Lens: Productivity (Atomic Habits, Deep Work, One Thing). One priority beats ten. Environment beats willpower. Micro-reps fit Mauritian commutes and tired evenings. No guilt-streak lecturing."
  },
  {
    key: "personal_finance",
    label: "Personal Finance",
    description: "Money mindset, runway, saving",
    enginePrompt:
      "Lens: Personal Finance (Psychology of Money, Babylon, cashflow thinking). Behavior beats spreadsheets. Shame-free runway talk. MUR, Juice/Blink, family money pressure, rent and payday cycles."
  },
  {
    key: "business",
    label: "Business",
    description: "Shops, side hustles, systems",
    enginePrompt:
      "Lens: Business (E-Myth, Traction). Work on the business not just in it. Systems beat heroics. Small retail, tourism swings, family business reality in Mauritius."
  },
  {
    key: "self_help",
    label: "Self Help",
    description: "Confidence, identity, direction",
    enginePrompt:
      "Lens: Self Help (Mindset, identity work). Small proof beats affirmations. Responsibility without self-attack. Respect family and cultural identity pressure."
  },
  {
    key: "critical_thinking",
    label: "Critical Thinking",
    description: "Decisions, bias, clarity",
    enginePrompt:
      "Lens: Critical Thinking (slow thinking, antifragility). Separate signal from noise on big calls. WhatsApp-forward skepticism. No smug paralysis."
  },
  {
    key: "relationship",
    label: "Relationship",
    description: "Love, family, attachment",
    enginePrompt:
      "Lens: Relationship (attachment, love languages, NVC). Secure base before advice. Boundaries are love. Extended family and island relationship dynamics."
  },
  {
    key: "human_behavior",
    label: "Human Behavior",
    description: "Power, influence, office politics",
    enginePrompt:
      "Lens: Human Behavior (48 Laws, Influence). Read incentives and ego. Build leverage without burning bridges. Small-island reputation is currency."
  },
  {
    key: "philosophy",
    label: "Philosophy",
    description: "Stoicism, meaning, calm",
    enginePrompt:
      "Lens: Philosophy (Stoicism). Control what you can. Virtue in small daily choices. Faith-friendly when user signals religion; never preach."
  },
  {
    key: "discipline",
    label: "Discipline",
    description: "Mental toughness, follow-through",
    enginePrompt:
      "Lens: Discipline (ownership, obstacle as way). Own the next ten minutes. No bootcamp abuse when mental health is live."
  },
  {
    key: "communication",
    label: "Communication",
    description: "Hard talks, negotiation",
    enginePrompt:
      "Lens: Communication (crucial conversations, tactical empathy). Safety then truth. One clear ask. Calibrate directness for Mauritian high-context culture."
  },
  {
    key: "health",
    label: "Health",
    description: "Sleep, energy, basics",
    enginePrompt:
      "Lens: Health (sleep-movement-stress triangle). Never diagnose. Defer to GP for symptoms. Heat, carer burnout, commute exhaustion."
  },
  {
    key: "career",
    label: "Career",
    description: "Jobs, pivots, skills",
    enginePrompt:
      "Lens: Career (career capital before leap). Skills plus proof beat passion alone. Ébène vs local jobs, contract work, reputation on a small island."
  },
  {
    key: "parenting",
    label: "Parenting",
    description: "Kids, tuition, carers",
    enginePrompt:
      "Lens: Parenting (connection before correction). Tuition pressure, sandwich generation, elder plus child load. No judging parenting styles."
  }
];

export const HELP_FOCUS_BY_KEY: Record<HelpFocusKey, HelpFocusCatalogEntry> = Object.fromEntries(
  HELP_FOCUS_CATALOG.map((entry) => [entry.key, entry])
) as Record<HelpFocusKey, HelpFocusCatalogEntry>;
