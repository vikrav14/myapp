import type { MauriUser } from "../types.js";

export function buildHelpMenu(user: MauriUser): string {
  const squadLine =
    user.subscription_status === "Trial_Active" || user.subscription_status === "Paid_Active"
      ? "\nSquads (included on trial): create squad, join CODE, share squad, squad status, squad goal study | save | hustle | balance, squad goal custom Your theme — focus study habits todos money."
      : "";

  return `Mauri command menu

Just talk normally for brain dumps — spending, tasks, habits, stress. I extract and remember.

Daily
- 7:00 morning brief (weather, traffic, your tags)
- lesson — today's 2-minute insight

Discover yourself
- what do you know about me — your person profile (not just logs)
- remember that … — save something about you
- forget that … — remove a stored fact
- my focus — this week's one habit
- my streaks — habit consistency (no guilt if you miss)
- roast me — sharp truth from your week
- hype me — celebrate what's working
- rate 1–5 / mauri feedback — after Sunday report, tune how I read you

Morning brief
- my lane — brief lane, tags, and modules
- my modules — career / habits / founder / student tools
- add habits / remove founder — toggle modules
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
- followups on / followups off — open-loop + proactive mate check-ins (max ~3/week)
- my followups — see pending open-loop check-ins
- my checkins — proactive ping status · not now — pause 7 days
- quiet hours — unprompted ping quiet window status
- quiet hours on / quiet hours off — mute unprompted pings overnight (default 10pm–7am)

Local alerts
- Mauri pings school closures, heavy rain, cyclone warnings
- alerts on / alerts off · school alerts on / school alerts off
- my alerts — recent urgent advisories

Money
- snap a receipt photo — auto-log spending
- my runway — till-payday breathing room
- payday 25 — set payday day
- salary 25000 — set monthly income

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
squad goal study — set weekly squad pact (save | hustle | balance | custom)
my focus — this week's one habit
roast me — truth from your week
my streaks — habit streaks
quantum pick 1 5 — let the universe decide
remind me to gym at 6pm — schedule a ping
calendar add dentist on tue at 10am — add an event
snap receipts — photo logs spending instantly
my runway — till-payday money check
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
