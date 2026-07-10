import type { MauriModuleKey, WhatsAppInteractiveOutbound } from "../types.js";
import { buildArchetypePickerRows } from "./archetype-catalog.js";
import { HELP_FOCUS_CATALOG } from "./help-focus.constants.js";
import type { HelpFocusKey } from "./help-focus.constants.js";
import { HELP_FOCUS_BY_KEY } from "./help-focus.constants.js";
import { formatHelpFocusLabel } from "./help-focus-inference.service.js";
import { PACE_PRESET_CATALOG } from "./notification-pace.constants.js";
import type { ProactivePacePreset } from "./notification-pace.constants.js";
import { MODULE_CATALOG } from "./user-modules.constants.js";

const HELP_DOMAIN_REPLY_ENTRIES = Object.fromEntries(
  HELP_FOCUS_CATALOG.map((entry) => [`help_domain_${entry.key}`, `help domain ${entry.key.replace(/_/g, " ")}`])
) as Record<string, string>;

const PACE_REPLY_ENTRIES = Object.fromEntries(
  PACE_PRESET_CATALOG.map((entry) => [`pace_${entry.key}`, `pace ${entry.key}`])
) as Record<string, string>;

export const INTERACTIVE_REPLY_MAP: Record<string, string> = {
  archetype_student: "Student Grind",
  archetype_corporate: "Corporate / Career",
  archetype_entrepreneur: "Entrepreneur Mode",
  archetype_life: "Life & Habit Tracking",
  archetype_custom: "Custom",
  brief_focus_work: "Work & money",
  brief_focus_life: "Life & balance",
  brief_focus_hustle: "Hustle & projects",
  brief_focus_mix: "Mix of everything",
  module_suggested: "modules suggested",
  module_career: "modules career",
  module_habits: "modules habits",
  module_founder: "modules founder",
  module_student: "modules student",
  module_none: "modules none",
  topics_ok: "OK",
  topics_traffic_money_local: "Traffic Money LocalBuzz",
  topics_traffic_tech_money: "Traffic Tech Money",
  topics_tech_money_local: "Tech Money LocalBuzz",
  topics_traffic_local_ent: "Traffic LocalBuzz Entertainment",
  rate_1: "rate 1",
  rate_2: "rate 2",
  rate_3: "rate 3",
  rate_4: "rate 4",
  rate_5: "rate 5",
  help_focus: "my focus",
  help_focus_confirm: "help focus confirm",
  help_advice_focus: "help focus",
  help_playbook: "my playbook",
  help_roast: "roast me",
  help_hype: "hype me",
  help_runway: "my runway",
  help_reminders: "my reminders",
  help_squad: "my squad",
  help_full: "show full menu",
  express_start: "start my trial",
  feedback_prompt: "mauri feedback",
  morning_mood_1: "mood 1",
  morning_mood_2: "mood 2",
  morning_mood_3: "mood 3",
  morning_mood_4: "mood 4",
  morning_mood_5: "mood 5",
  morning_mood_skip: "skip mood",
  reminder_done: "done",
  reminder_snooze: "snooze 1h",
  reminder_snooze_15m: "snooze 15m",
  reminder_snooze_3h: "snooze 3h",
  reminder_snooze_tomorrow: "snooze tomorrow",
  reminder_skip: "skip"
};

Object.assign(INTERACTIVE_REPLY_MAP, HELP_DOMAIN_REPLY_ENTRIES);
Object.assign(INTERACTIVE_REPLY_MAP, PACE_REPLY_ENTRIES);

export function resolveInteractiveReplyId(replyId: string): string | null {
  return INTERACTIVE_REPLY_MAP[replyId] ?? null;
}

export function buildArchetypePickerInteractive(input: {
  firstName?: string | null;
  isNewUser: boolean;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";
  const opener = input.isNewUser
    ? `Hey ${name}. I'm Mauri — your week in WhatsApp, tuned to how you live.`
    : `Almost in, ${name}. Pick a starting lane for your 7 AM pulse — closest fit is fine.`;

  return {
    header: "Welcome to Mauri",
    body: opener,
    footer: "Personal stuff stays separate · custom tags on the next step",
    listButtonLabel: "Pick vibe",
    sections: [
      {
        title: "Brief lanes",
        rows: buildArchetypePickerRows()
      }
    ]
  };
}

export function buildExpressStartInteractive(): WhatsAppInteractiveOutbound {
  return {
    header: "Ready when you are",
    body: "One tap starts your 7-day trial with the setup above.",
    buttons: [{ id: "express_start", title: "Start my trial" }]
  };
}

export function buildHeavyShareArchetypePickerInteractive(input: {
  firstName?: string | null;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";

  return {
    header: "Your 7am brief",
    body: `${name} — when you're ready, pick the closest lane for your morning pulse only.`,
    footer: "Take your time · Your own mix is option 5",
    listButtonLabel: "Pick brief lane",
    sections: [
      {
        title: "Brief lanes",
        rows: buildArchetypePickerRows()
      }
    ]
  };
}

export function buildBriefFocusPickerInteractive(input: {
  firstName?: string | null;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";

  return {
    header: "Your 7am brief",
    body: `${name} — what should your morning pulse focus on? Pick closest or type your own.`,
    footer: "Tap a quick pick · or reply in your own words",
    listButtonLabel: "Pick focus",
    sections: [
      {
        title: "Quick picks",
        rows: [
          {
            id: "brief_focus_work",
            title: "Work & money",
            description: "Job, salary, commute, finances"
          },
          {
            id: "brief_focus_life",
            title: "Life & balance",
            description: "Family, habits, mood, routines"
          },
          {
            id: "brief_focus_hustle",
            title: "Hustle & projects",
            description: "Side app, startup, building things"
          },
          {
            id: "brief_focus_mix",
            title: "Mix of everything",
            description: "Work, life, side projects — no single box"
          }
        ]
      }
    ]
  };
}

export function buildModulePickerInteractive(input: {
  firstName?: string | null;
  suggestedModules: MauriModuleKey[];
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";
  const suggested =
    input.suggestedModules.length > 0 ? input.suggestedModules.map((m) => MODULE_CATALOG[m].shortLabel).join(" + ") : "none";

  return {
    header: "Extra tools",
    body: `${name} — optional modules unlock payday runway, habit check-ins, and more. Suggested: ${suggested}.`,
    footer: "Tap one · or reply career habits",
    listButtonLabel: "Pick modules",
    sections: [
      {
        title: "Modules",
        rows: [
          {
            id: "module_suggested",
            title: "Use suggested",
            description: suggested === "none" ? "Brief lane defaults only" : suggested
          },
          {
            id: "module_career",
            title: MODULE_CATALOG.career.label,
            description: MODULE_CATALOG.career.description
          },
          {
            id: "module_habits",
            title: MODULE_CATALOG.habits.label,
            description: MODULE_CATALOG.habits.description
          },
          {
            id: "module_founder",
            title: MODULE_CATALOG.founder.label,
            description: MODULE_CATALOG.founder.description
          },
          {
            id: "module_student",
            title: MODULE_CATALOG.student.label,
            description: MODULE_CATALOG.student.description
          },
          {
            id: "module_none",
            title: "Brief only",
            description: "No extra modules — 7am brief only"
          }
        ]
      }
    ]
  };
}

export function buildTopicsPickerInteractive(archetype: string): WhatsAppInteractiveOutbound {
  return {
    header: "Morning brief tags",
    body: `For ${archetype}, pick 3–5 tags for your 7 AM vibe check — or type your own mix.`,
    footer: "Suggested combos below · custom tags anytime",
    listButtonLabel: "Pick tags",
    sections: [
      {
        title: "Quick picks",
        rows: [
          {
            id: "topics_ok",
            title: "Use suggested",
            description: "Mauri picks for your archetype"
          },
          {
            id: "topics_traffic_money_local",
            title: "Traffic Money Local",
            description: "Traffic · Money · LocalBuzz"
          },
          {
            id: "topics_traffic_tech_money",
            title: "Traffic Tech Money",
            description: "Traffic · Tech · Money"
          },
          {
            id: "topics_tech_money_local",
            title: "Tech Money Local",
            description: "Tech · Money · LocalBuzz"
          },
          {
            id: "topics_traffic_local_ent",
            title: "Traffic Local Fun",
            description: "Traffic · LocalBuzz · Entertainment"
          }
        ]
      }
    ]
  };
}

export function buildSundayRatingInteractive(): WhatsAppInteractiveOutbound {
  return {
    header: "From Mauri",
    body: "Quick pulse — how useful was I this week?",
    footer: "Optional · tap a score",
    listButtonLabel: "Rate Mauri",
    sections: [
      {
        title: "This week",
        rows: [
          { id: "rate_1", title: "1 — Not really", description: "Missed the mark" },
          { id: "rate_2", title: "2 — Meh", description: "Some hits, some misses" },
          { id: "rate_3", title: "3 — Okay", description: "Decent, room to grow" },
          { id: "rate_4", title: "4 — Solid", description: "Mostly landing" },
          { id: "rate_5", title: "5 — Nailed it", description: "Really getting me" }
        ]
      }
    ]
  };
}

export function buildSundayFeedbackInteractive(): WhatsAppInteractiveOutbound {
  return {
    body: "Still calibrating to you — rate me or tell me what I'm missing.",
    buttons: [
      { id: "rate_4", title: "Rate 4 ⭐" },
      { id: "feedback_prompt", title: "Give context" }
    ]
  };
}

export function buildHelpMenuInteractive(): WhatsAppInteractiveOutbound {
  return {
    header: "Mauri menu",
    body: "Tap what you need — or just talk normally for brain dumps.",
    footer: "Reply anytime in plain chat too",
    listButtonLabel: "Open menu",
    sections: [
      {
        title: "Discover",
        rows: [
          { id: "help_focus", title: "My focus", description: "This week's one habit" },
          { id: "help_advice_focus", title: "Advice focus", description: "Money, career, discipline…" },
          { id: "help_roast", title: "Roast me", description: "Sharp truth from your week" },
          { id: "help_hype", title: "Hype me", description: "Celebrate what's working" }
        ]
      },
      {
        title: "Practical",
        rows: [
          { id: "help_runway", title: "My runway", description: "Till-payday money check" },
          { id: "help_reminders", title: "My reminders", description: "Active pings" },
          { id: "help_squad", title: "My squad", description: "Accountability crew" },
          { id: "help_full", title: "Full command list", description: "Everything Mauri can do" }
        ]
      }
    ]
  };
}

export function buildSundayContextInteractive(): WhatsAppInteractiveOutbound {
  return {
    body: "If I'm missing how you work, tell me what to fix.",
    buttons: [{ id: "feedback_prompt", title: "Give context" }]
  };
}

export function buildMorningMoodCheckInteractive(): WhatsAppInteractiveOutbound {
  return {
    header: "Quick check",
    body: "How's today feeling?",
    footer: "Private — never in your 7am news",
    listButtonLabel: "Rate 1–5",
    sections: [
      {
        title: "Today vs yesterday",
        rows: [
          { id: "morning_mood_1", title: "1 — Rough", description: "Heavier than yesterday" },
          { id: "morning_mood_2", title: "2 — Low", description: "Not great" },
          { id: "morning_mood_3", title: "3 — OK", description: "About the same" },
          { id: "morning_mood_4", title: "4 — Good", description: "Better" },
          { id: "morning_mood_5", title: "5 — Solid", description: "Much better" },
          { id: "morning_mood_skip", title: "Skip", description: "Not today" }
        ]
      }
    ]
  };
}

export function buildReminderDeliveryInteractive(label: string): WhatsAppInteractiveOutbound {
  return {
    header: "Reminder",
    body: `⏰ ${label}`,
    footer: "Tap an action",
    listButtonLabel: "Respond",
    sections: [
      {
        title: "Actions",
        rows: [
          { id: "reminder_done", title: "Done", description: "Mark complete" },
          { id: "reminder_snooze_15m", title: "Snooze 15 min", description: "Ping again shortly" },
          { id: "reminder_snooze", title: "Snooze 1 hour", description: "Check back later" },
          { id: "reminder_snooze_3h", title: "Snooze 3 hours", description: "Later today" },
          { id: "reminder_snooze_tomorrow", title: "Tomorrow 9am", description: "Remind me tomorrow morning" },
          { id: "reminder_skip", title: "Skip", description: "Skip this ping" }
        ]
      }
    ]
  };
}

export function buildHelpFocusActivationInteractive(input: {
  firstName?: string | null;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";

  return {
    header: "Advice focus",
    body: `${name} — happy with that advice lane, or want to switch?`,
    footer: "Tap My playbook for frameworks — then confirm or switch",
    buttons: [
      { id: "help_focus_confirm", title: "Looks good" },
      { id: "help_advice_focus", title: "Pick lane" },
      { id: "help_playbook", title: "My playbook" }
    ]
  };
}

export const WHATSAPP_LIST_MAX_ROWS = 10;

export function buildHelpFocusPickerRows(input: {
  suggestedPrimary?: HelpFocusKey | null;
  suggestedSecondary?: HelpFocusKey | null;
}): Array<{ id: string; title: string; description: string }> {
  const prioritized = [];
  const seen = new Set<HelpFocusKey>();

  for (const key of [input.suggestedPrimary, input.suggestedSecondary]) {
    if (!key || seen.has(key)) {
      continue;
    }

    prioritized.push(HELP_FOCUS_BY_KEY[key]);
    seen.add(key);
  }

  for (const entry of HELP_FOCUS_CATALOG) {
    if (seen.has(entry.key)) {
      continue;
    }

    prioritized.push(entry);
    if (prioritized.length >= WHATSAPP_LIST_MAX_ROWS) {
      break;
    }
  }

  return prioritized.map((entry) => ({
    id: `help_domain_${entry.key}`,
    title: entry.label.slice(0, 24),
    description: entry.description.slice(0, 72)
  }));
}

export function buildHelpFocusPickerInteractive(input: {
  firstName?: string | null;
  suggestedPrimary?: HelpFocusKey | null;
  suggestedSecondary?: HelpFocusKey | null;
  /** activation = no repeat of focus labels (explanation already sent in text) */
  variant?: "activation" | "status" | undefined;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";

  const body =
    input.variant === "activation"
      ? `${name} — tap Pick lane to confirm or switch advice focus.`
      : input.suggestedPrimary && input.suggestedSecondary
        ? `${name} — for advice I'm leaning into ${formatHelpFocusLabel(input.suggestedPrimary)} + ${formatHelpFocusLabel(input.suggestedSecondary)}. Pick a different lane if you want.`
        : input.suggestedPrimary
          ? `${name} — for advice I'm leaning into ${formatHelpFocusLabel(input.suggestedPrimary)}. Pick a different lane if you want.`
          : `${name} — what do you want me to help with most?`;

  const pickerRowInput: {
    suggestedPrimary?: HelpFocusKey | null;
    suggestedSecondary?: HelpFocusKey | null;
  } = {};

  if (input.suggestedPrimary !== undefined) {
    pickerRowInput.suggestedPrimary = input.suggestedPrimary;
  }

  if (input.suggestedSecondary !== undefined) {
    pickerRowInput.suggestedSecondary = input.suggestedSecondary;
  }

  const rows = buildHelpFocusPickerRows(pickerRowInput);

  return {
    header: "Advice focus",
    body,
    footer: "Not listed? Reply help domain <lane> — e.g. help domain philosophy",
    listButtonLabel: "Pick lane",
    sections: [
      {
        title: "Advice lanes",
        rows
      }
    ]
  };
}

export function buildPaymentCtaInteractive(input: {
  provider: "juice" | "blink";
  firstName?: string | null;
  amountRs: number;
  checkoutUrl: string;
  variant?: "locked" | "trial_cliffhanger" | "voluntary";
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";
  const providerLabel = input.provider === "juice" ? "Pay with Juice" : "Pay with Blink";
  const body =
    input.variant === "trial_cliffhanger"
      ? `${name} — your trial window is closing. Rs ${input.amountRs}/month keeps memory, runway, and Sunday reports live.`
      : input.variant === "voluntary"
        ? `${name} — premium is Rs ${input.amountRs}/month. Tap below when you're ready.`
        : `${name} — your vault is locked. Rs ${input.amountRs}/month unlocks memory, runway, and Sunday reports.`;

  return {
    header: "Keep Mauri unlocked",
    body,
    footer: "Questions? Just ask. Reply pay anytime.",
    ctaUrl: {
      displayText: providerLabel,
      url: input.checkoutUrl
    }
  };
}

export function buildPacePickerInteractive(input: {
  firstName?: string | null;
  suggestedPreset?: ProactivePacePreset | null;
}): WhatsAppInteractiveOutbound {
  const name = input.firstName?.trim() || "there";

  return {
    header: "Your Mauri pace",
    body: `${name} — how often should I check in unprompted? Replies when you message are always on.`,
    footer: "Change anytime · reply my pace",
    listButtonLabel: "Pick pace",
    sections: [
      {
        title: "Unprompted check-ins",
        rows: PACE_PRESET_CATALOG.map((entry) => ({
          id: `pace_${entry.key}`,
          title: entry.label.slice(0, 24),
          description: entry.description.slice(0, 72)
        }))
      }
    ]
  };
}
