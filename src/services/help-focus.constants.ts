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
  "parenting",
  "psychology",
  "art"
] as const;

export type HelpFocusKey = (typeof HELP_FOCUS_KEYS)[number];

export interface HelpFocusCatalogEntry {
  key: HelpFocusKey;
  label: string;
  description: string;
  /** Plain-language approach for users — no book titles */
  userLens: string;
  enginePrompt: string;
}

export const HELP_FOCUS_CATALOG: HelpFocusCatalogEntry[] = [
  {
    key: "productivity",
    label: "Productivity",
    description: "Focus, habits, deep work",
    userLens: "One priority at a time — environment and small reps, not guilt-streak lectures",
    enginePrompt:
      "Lens: Productivity (Atomic Habits, Deep Work, One Thing). One priority beats ten. Environment beats willpower. Micro-reps fit Mauritian commutes and tired evenings. No guilt-streak lecturing."
  },
  {
    key: "personal_finance",
    label: "Personal Finance",
    description: "Money mindset, runway, saving",
    userLens: "Shame-free money habits — runway, family pressure, saving without spreadsheet guilt",
    enginePrompt:
      "Lens: Personal Finance (Psychology of Money, Babylon, cashflow thinking). Behavior beats spreadsheets. Shame-free runway talk. MUR, Juice/Blink, family money pressure, rent and payday cycles."
  },
  {
    key: "business",
    label: "Business",
    description: "Shops, side hustles, systems",
    userLens: "Systems over heroics — cashflow and focus for shops and side hustles",
    enginePrompt:
      "Lens: Business (E-Myth, Traction). Work on the business not just in it. Systems beat heroics. Small retail, tourism swings, family business reality in Mauritius."
  },
  {
    key: "self_help",
    label: "Self Help",
    description: "Confidence, identity, direction",
    userLens: "Small proof beats pep talks — identity and direction without self-attack",
    enginePrompt:
      "Lens: Self Help (Mindset, identity work). Small proof beats affirmations. Responsibility without self-attack. Respect family and cultural identity pressure."
  },
  {
    key: "critical_thinking",
    label: "Critical Thinking",
    description: "Decisions, bias, clarity",
    userLens: "Slow down big calls — separate signal from noise and WhatsApp-forward hype",
    enginePrompt:
      "Lens: Critical Thinking (slow thinking, antifragility). Separate signal from noise on big calls. WhatsApp-forward skepticism. No smug paralysis."
  },
  {
    key: "relationship",
    label: "Relationship",
    description: "Love, family, attachment",
    userLens: "Secure base first — boundaries, guilt trips, and island family dynamics",
    enginePrompt:
      "Lens: Relationship (attachment, love languages, NVC). Secure base before advice. Boundaries are love. Extended family and island relationship dynamics."
  },
  {
    key: "human_behavior",
    label: "Human Behavior",
    description: "Power, influence, office politics",
    userLens: "Read incentives and ego — leverage without burning bridges on a small island",
    enginePrompt:
      "Lens: Human Behavior (48 Laws, Influence). Read incentives and ego. Build leverage without burning bridges. Small-island reputation is currency."
  },
  {
    key: "philosophy",
    label: "Philosophy",
    description: "Stoicism, meaning, calm",
    userLens: "Control what you can — calm and meaning in small daily choices",
    enginePrompt:
      "Lens: Philosophy (Stoicism). Control what you can. Virtue in small daily choices. Faith-friendly when user signals religion; never preach."
  },
  {
    key: "discipline",
    label: "Discipline",
    description: "Mental toughness, follow-through",
    userLens: "Own the next ten minutes — follow-through without bootcamp abuse",
    enginePrompt:
      "Lens: Discipline (ownership, obstacle as way). Own the next ten minutes. No bootcamp abuse when mental health is live."
  },
  {
    key: "communication",
    label: "Communication",
    description: "Hard talks, negotiation",
    userLens: "Safety then truth — hard talks and boundaries in Mauritian high-context culture",
    enginePrompt:
      "Lens: Communication (crucial conversations, tactical empathy). Safety then truth. One clear ask. Calibrate directness for Mauritian high-context culture."
  },
  {
    key: "health",
    label: "Health",
    description: "Sleep, energy, basics",
    userLens: "Sleep, movement, stress basics — never diagnosing, always deferring symptoms to a GP",
    enginePrompt:
      "Lens: Health (sleep-movement-stress triangle). Never diagnose. Defer to GP for symptoms. Heat, carer burnout, commute exhaustion."
  },
  {
    key: "career",
    label: "Career",
    description: "Jobs, pivots, skills",
    userLens: "Skills and proof before big leaps — Ébène, contracts, reputation on a small island",
    enginePrompt:
      "Lens: Career (career capital before leap). Skills plus proof beat passion alone. Ébène vs local jobs, contract work, reputation on a small island."
  },
  {
    key: "parenting",
    label: "Parenting",
    description: "Kids, tuition, carers",
    userLens: "Connection before correction — tuition load, carer stress, sandwich-generation pressure",
    enginePrompt:
      "Lens: Parenting (connection before correction). Tuition pressure, sandwich generation, elder plus child load. No judging parenting styles."
  },
  {
    key: "psychology",
    label: "Psychology",
    description: "Patterns, triggers, emotional regulation",
    userLens: "Name the pattern behind the spiral — triggers, nervous system, small resets; not therapy cosplay",
    enginePrompt:
      "Lens: Psychology (Feeling Good CBT, Body Keeps the Score, Emotional Intelligence, Happiness Trap ACT). Patterns over labels. Trauma-aware without diagnosing. Defer crisis and meds to professionals."
  },
  {
    key: "art",
    label: "Art",
    description: "Creative work, craft, resistance",
    userLens: "Ritual beats muse-chasing — ship small, beat resistance, protect the craft alongside real life",
    enginePrompt:
      "Lens: Art & creativity (War of Art, Artist's Way, Steal Like an Artist, Big Magic). Resistance is normal. Consistency beats inspiration. Side projects after work; no starving-artist guilt in Mauritius."
  }
];

export const HELP_FOCUS_BY_KEY: Record<HelpFocusKey, HelpFocusCatalogEntry> = Object.fromEntries(
  HELP_FOCUS_CATALOG.map((entry) => [entry.key, entry])
) as Record<HelpFocusKey, HelpFocusCatalogEntry>;
