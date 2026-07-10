import type { HelpFocusKey } from "./help-focus.constants.js";

/** Book/framework names users can request via help focus sources — not shown in routine advice. */
export const HELP_FOCUS_FRAMEWORKS: Record<HelpFocusKey, string[]> = {
  productivity: ["Atomic Habits", "Deep Work", "The One Thing", "Getting Things Done"],
  personal_finance: ["The Psychology of Money", "The Richest Man in Babylon", "Rich Dad / Cashflow Quadrant"],
  business: ["The E-Myth Revisited", "Traction", "Good to Great", "Lean Startup"],
  self_help: ["Mindset", "Psycho-Cybernetics", "12 Rules for Life", "The Subtle Art of Not Giving a F*ck"],
  critical_thinking: ["Thinking, Fast and Slow", "The Black Swan", "Antifragile", "Factfulness"],
  relationship: ["Attached", "The 5 Love Languages", "How to Not Die Alone", "Nonviolent Communication"],
  human_behavior: ["The 48 Laws of Power", "Influence", "The Laws of Human Nature", "Games People Play"],
  philosophy: ["Stoicism (Meditations)", "Man's Search for Meaning", "Seneca", "Epictetus"],
  discipline: ["Can't Hurt Me", "Extreme Ownership", "The Obstacle Is the Way", "Discipline Equals Freedom"],
  communication: [
    "Crucial Conversations",
    "How to Win Friends and Influence People",
    "Never Split the Difference",
    "Difficult Conversations"
  ],
  health: ["Why We Sleep", "Sleep–movement–stress triangle"],
  career: ["So Good They Can't Ignore You", "What Color Is Your Parachute?"],
  parenting: ["How to Talk So Kids Will Listen", "Gentle parenting", "Connection before correction"],
  psychology: ["Feeling Good (CBT)", "The Body Keeps the Score", "Emotional Intelligence", "The Happiness Trap (ACT)"],
  art: ["The War of Art", "The Artist's Way", "Steal Like an Artist", "Big Magic"]
};
