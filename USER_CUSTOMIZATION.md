# User customization in Mauri

What users can personalize today, how they do it, and where more custom options could land later.

---

## Summary table

| Area | User can customize? | How | Stored on |
|------|---------------------|-----|-----------|
| **Archetype** | ✅ Pick at onboarding | Tap archetype in WhatsApp flow | `users.archetype` |
| **Morning brief tags** | ✅ 3–5 topics | `update topics Traffic Money Tech` | `users.topic_preferences` |
| **Morning digest** | ✅ On/off | `digest on` / `digest off` | `users.morning_digest_enabled` |
| **Reminders** | ✅ Label + time + repeat | `remind me to … at 6pm daily` | `scheduled_reminders` |
| **Calendar** | ✅ Events + iCal URL | `calendar add …`, `connect calendar <url>` | `calendar_events`, user iCal |
| **Calendar sync** | ✅ On/off | `calendar on` / `calendar off` | `users.calendar_sync_enabled` |
| **Payday / salary** | ✅ Day + income | `payday 25`, `salary 25000` | `users.payday_day_of_month`, `monthly_income_rs` |
| **Squad weekly pact** | ✅ Preset + **custom** | `squad goal study` or `squad goal custom Exam week — focus study todos` | `squads.weekly_pact_*` |
| **Squad name** | ✅ At create | `create squad Study Crew` | `squads.squad_name` |
| **Memory resurfacing** | ✅ On/off | `resurface on` / `resurface off` | `users.memory_resurfacing_enabled` |
| **Open-loop follow-ups** | ✅ On/off | `followups on` / `followups off` | `users.open_loop_followups_enabled` |
| **Proactive check-ins** | ✅ On/off (shared) + pause | `followups on/off`, `not now`, `my checkins` | `users.open_loop_followups_enabled`, `users.proactive_checkins_paused_until` |
| **Local alerts** | ✅ On/off | `alerts on` / `alerts off` | `users.local_alerts_enabled` |
| **School alerts** | ✅ On/off | `school alerts on` / `off` | `users.school_alerts_enabled` |
| **Weekly focus** | ⚠️ System-assigned | `my focus` (read); set via onboarding/engagement | engagement layer |
| **User Mind tone** | ⚠️ Implicit | Learnt from chat + logs (advice_preferences, things_to_avoid) | `user_mind_snapshots` |
| **Chat personality** | ⚠️ Via archetype + mind | No free-text “be more sarcastic” command yet | prompts + mind |
| **Reminder label** | ✅ Free text | Any text in remind command | `scheduled_reminders.label` |
| **Quantum pick** | ✅ Options in message | `quantum pick 1 5` or named choices | — (stateless) |
| **Admin override** | ✅ Ops only | Admin panel PATCH user | `users.*` |

---

## Onboarding & identity

### Archetype
- **When:** First chats (`awaiting_archetype`)
- **Options:** Student Grind, Corporate / Career, Entrepreneur Mode, Life & Habit Tracking
- **Effect:** Voice tone, morning brief tag suggestions, default squad pact, weekly focus lane

### Morning brief topics
- **Commands:** `my topics`, `update topics Traffic Money Tech`, `digest on/off`
- **Valid tags:** Traffic, Tech, Money, LocalBuzz, Entertainment (3–5 required on update)
- **Effect:** 7 AM brief content mix

---

## Time & reminders

### Scheduled reminders
- **Create:** `remind me to call mum at 6pm`, `… daily at 8am`, `… every Monday at 7am`
- **Manage:** `my reminders`, `cancel reminder 1`, `done`, `skip`, `snooze 1h`
- **Custom:** User-chosen label, time, repeat pattern (once / daily / weekdays / weekly)

### Calendar
- **Add events:** `calendar add team sync on friday at 3pm`
- **External sync:** `connect calendar <ical-url>`
- **Toggle:** `calendar on` / `calendar off`
- **Pre-reminders:** ~30 min before synced events

---

## Money

- **Payday day:** `payday 25`
- **Monthly income:** `salary 25000`
- **Spending:** Natural chat + receipt photos (category inferred)

---

## Squads (accountability)

### Preset pacts
`squad goal study | save | hustle | balance` — fixed scoring profiles.

### Custom pact (new)
```text
squad goal custom Exam cram — focus study todos
squad goal custom Gym January — focus habits
squad goal custom No takeaway week — focus money
```

- **Label:** 2–40 characters (your squad’s theme name)
- **Focus:** One or more of `study`, `habits`, `todos`, `money` (aliases: gym, tasks, spend, etc.)
- **Scoring:** Merges boosts from selected focuses (capped per dimension)
- **Clear:** `squad goal clear` → default scoring

### Squad ops
`create squad [name]`, `join CODE`, `share squad`, `my squad`, `leave squad`

---

## Proactive features (toggles)

| Feature | Off command | On command |
|---------|-------------|------------|
| Morning digest | `digest off` | `digest on` |
| Memory resurfacing | `resurface off` | `resurface on` |
| Open-loop follow-ups | `followups off` | `followups on` |
| Proactive mate check-ins | `not now` (7-day pause) or `followups off` | `followups on` |
| Local alerts | `alerts off` | `alerts on` |
| School-only alerts | `school alerts off` | `school alerts on` |
| Calendar delivery | `calendar off` | `calendar on` |

---

## Learned / indirect customization (no single command)

### User Mind (PR #12)
Nightly reflection builds:
- `advice_preferences` — how Mauri should coach you
- `things_to_avoid` — patterns that feel wrong
- `personality_notes`, goals, open loops

**Customisation path:** Talk naturally over days; mind updates off-peak. No `set personality sarcastic` yet.

### Semantic memory
What you say is embedded and retrieved by meaning — user controls via **what they share**, not a settings screen.

### Weekly focus / streaks / roast-hype
Driven by your data and archetype; read with `my focus`, `my streaks`, `roast me`, `hype me`.

---

## Not customizable today (gaps)

| Gap | Workaround | Possible future |
|-----|------------|-----------------|
| Free-text reply personality | Archetype + User Mind | `tone gentle` / `tone direct` |
| Custom morning brief time | Fixed 7 AM Mauritius | `brief at 6:30` |
| Custom squad scoring numbers | Use custom focus keywords | `squad goal custom … weights 3 4 2 1` (v2) |
| Google Calendar OAuth | iCal URL | Native calendar connect |
| Choose Gemini vs Claude | Single stack | Deep Think mode (see `FUTURE_IDEAS.md`) |
| User-facing memory browser | Chat recall only | `what do you remember?` |

---

## Related docs

- `README.md` — command list
- `FEEL_SAFE_OPTIMIZATION.md` — what must not be stripped from replies
- `FUTURE_IDEAS.md` — deferred features
