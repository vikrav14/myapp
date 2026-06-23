import type { MauriUser } from "../types.js";

export function buildHelpMenu(user: MauriUser): string {
  const squadLine =
    user.subscription_status === "Trial_Active" || user.subscription_status === "Paid_Active"
      ? "\nSquads (included on trial): create squad, join CODE, share squad, squad status, squad goal study | save | hustle | balance."
      : "";

  return `Mauri command menu

Just talk normally for brain dumps — spending, tasks, habits, stress. I extract and remember.

Daily
- 7:00 morning brief (weather, traffic, your tags)
- lesson — today's 2-minute insight

Discover yourself
- my focus — this week's one habit
- my streaks — habit consistency (no guilt if you miss)
- roast me — sharp truth from your week
- hype me — celebrate what's working

Morning brief
- my topics — show your tags
- update topics Traffic Money Tech
- digest off / digest on

Reminders
- remind me to call mum at 6pm
- remind me to drink water daily at 8am
- my reminders — list active reminders
- cancel reminder 1

Calendar
- calendar add team sync on friday at 3pm
- my calendar / calendar today
- connect calendar <ical-url>
- calendar off / calendar on

Memory
- resurface on / resurface off — gentle memory pings (max 1/day)

Can't decide?
- quantum pick 1 5
- quantum pick Tribeca, Docker, Nandos

${squadLine}

Reply help or menu anytime.`;
}

export function buildQuickStartMenu(): string {
  return `Quick start commands:
help — full menu
create squad — invite mates (no group chat)
squad goal study — set weekly squad pact (save | hustle | balance)
my focus — this week's one habit
roast me — truth from your week
my streaks — habit streaks
quantum pick 1 5 — let the universe decide
remind me to gym at 6pm — schedule a ping
calendar add dentist on tue at 10am — add an event
lesson — today's insight`;
}

export function parseHelpCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "help" ||
    normalized === "menu" ||
    normalized === "commands" ||
    normalized === "what can you do" ||
    normalized === "show commands"
  );
}
