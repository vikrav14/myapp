# Vik Transcript Audit (7 Jul 2026)

Line-by-line trace of the real onboarding session against memory architecture.  
Shows what **worked**, what **stored**, and what **Sunday report would miss**.

---

## User message (know-you)

> I'm 31, working in a management company in Grand Baie but living in Vacoas. The winter rain and traffic are killing me. I make okay money, but my parents took a massive loan for my wedding last year and now they expect me to pay the monthly installments because my dad got laid off from his factory job. I want to build a side hustle in digital marketing at night to break out of this 9-to-5 loop, but by 8 PM my brain is completely fried and I just stare at the TV. I feel like a failure because I can't find the energy to change my life.

### Routing

| Step | Mechanism | Result |
|------|-----------|--------|
| Inbound | `onboarding_state === awaiting_know_you` | Onboarding path |
| Too short? | No (~120 words) | Continue |
| Extract | `extractUserMindProfile` (AI) | → `ingestUserMindMessage` |
| Store | `user_mind_facts` upsert | See table below |
| Life threads | `buildLifeThreadCandidatesFromFacts` (regex) | Scheduled follow-ups |
| Express setup | `inferExpressSetup` (rules on facts) | Archetype, modules, tags |
| Weekly focus | `inferWeeklyFocusFromFacts` | Family-money habit |
| Help focus | `inferHelpFocusFromFacts` | Personal Finance + Relationship |
| Ack | `resolveKnowYouAcknowledgement` (AI) | Empathetic multi-paragraph |

### Expected `user_mind_facts` (illustrative)

| category | fact_key | fact_value (user voice) |
|----------|----------|-------------------------|
| identity | age | 31 |
| location | area | Vacoas (lives); commute Grand Baie |
| life_context | work | management company Grand Baie |
| goals | side_hustle | digital marketing at night |
| goals | escape_9_5 | break out of 9–5 loop |
| stressors | wedding_loan | parents took massive wedding loan |
| stressors | family_money | expected to pay installments |
| stressors | burnout_evening | brain fried by 8pm, TV not hustle |
| stressors | self_worth | feel like a failure, no energy |
| relationships | dad | laid off factory job |
| relationships | parents | expect me to pay loan |

✅ **Strong capture** — this is why onboarding feels human.

### Life threads queued (from Mauri reply)

> gentle check-ins queued (dad lost factory job; parents — took massive wedding loan, expect me to pay after dad lost job)

| Source | Mechanism | Stored in |
|--------|-----------|-----------|
| Dad job loss | `family_care` or `personal_crossroads` regex on fact text | `open_loop_follow_ups` |
| Wedding loan pressure | `personal_crossroads` / money pattern | `open_loop_follow_ups` |

✅ **Working** — user sees Mauri “remembered the live stuff.”

### Derived setup (from Mauri reply)

| Field | Value | Inference driver |
|-------|-------|------------------|
| Morning pulse | commute + money pressure + work | Corporate/career + family money + commute facts |
| Modules | Career + Founder | Side hustle + job |
| Tags | #Traffic #Tech #Money | Commute + marketing/tech + money |
| Weekly habit | Log one family-money moment before you react | `hasFamilyMoneyPressure` |
| Help focus | Personal Finance + Relationship | Loan + dad + guilt/failure |

✅ **Coherent** — one story across fields.

---

## Activation message (after Start my trial)

Mauri listed pulse, modules, tags, weekly habit, help focus rationale, life thread note.

### Stored on `users` at activation

- `onboarding_state = active`
- `trial_*` timestamps
- `help_focus_primary/secondary`
- `weekly_focus_habit`
- `archetype`, `active_modules`, `topic_preferences`

✅ **Trial started correctly.**

---

## Pick lane / help focus (post-activation bugs — fixed in PR #54)

| User action | Expected | What happened (pre-fix) |
|-------------|----------|-------------------------|
| Looks good | Confirm help focus | ✅ Worked |
| Pick lane | Open 10-lane list | ❌ 13 rows → Meta reject → wrong fallback text |
| `help focus` ×4 | Status + list | ❌ Same fallback |
| change your advice lane | Open list | ❌ Fell through to generic AI |

**Not a memory issue** — delivery bug. Memory was already correct.

---

## If Vik said nothing else all week — Sunday report inputs

| Signal | Available? | In report? |
|--------|------------|------------|
| Momentum score | Low (few logs) | ✅ number only |
| Finance entries | 0 | ❌ “quiet week” |
| Habit logs | 0 | ❌ |
| Mood | 0 | ❌ |
| Wedding loan story | facts | ⚠️ AI prose only if prompt includes facts |
| Side hustle goal | facts | ⚠️ same |
| 8pm burnout pattern | facts + would be in snapshot after night 1 | ❌ snapshot not read |
| Open loops (dad, loan) | `open_loop_follow_ups` | ❌ not in report |
| Weekly focus progress | “log one family-money moment” | ❌ no completion tracking |

### What report would feel like

> “Sunday check-in, Vik. A quiet week on the logs — the pattern still matters. Momentum: 22/100.”

**Robotic** — because logs empty, snapshot unused, story buried in facts prompt only.

### What report *should* feel like (target)

> “Vik — no money logs this week, but the weight you named is still there: parents’ wedding loan, dad’s job gone, 8pm crash before the marketing dream gets a minute. Momentum’s thin on paper — that doesn’t mean the week didn’t count. One family-money moment logged beats zero. Side hustle: 0/3 nights — matches what you said about TV by 8. Next week: same focus — one boundary before you react.”

That requires **snapshot + facts + goals + open loops + week-over-week**, not just SQL counts.

---

## Hypothetical mid-week messages (not in transcript — gap demo)

| User says | Stored today? | Where |
|-----------|---------------|-------|
| “Paid Rs 8k to parents today” | ✅ if AI extracts finance | `finance_logs` |
| “Brother offered to help with loan” | ❌ likely chat only | `conversation_memories`; maybe snapshot tonight |
| “Remember brother is contributing now” | ✅ if user types exactly | `user_mind_facts` via remember |
| “Done” (todo) | ❌ | No completion path |
| “mood 2” | ✅ | `insights_vault` |

**Unified router fixes:** auto-route profile deltas + structured logs in one pass with ack.

---

## Vik audit summary

| Area | Grade | Note |
|------|-------|------|
| Know-you capture | A | Best part of product |
| Life threads | A | Visible in activation |
| Setup inference | A | Coherent modules/tags/focus |
| Post-activation UX | B→A | Fixed list/fallback bugs |
| Sunday report (if silent week) | D | Would feel empty/robotic |
| Mid-week memory | C | Facts frozen after onboarding |

**Onboarding converts trust; report must close the loop or trust decays by Sunday.**
