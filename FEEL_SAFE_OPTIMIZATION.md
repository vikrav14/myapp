# Feel-safe optimization checklist

> **Draft PR intent (PR #12):** Keep [`cursor/user-mind-snapshots-bb83`](https://github.com/vikrav14/myapp/pull/12) in **draft** until connection features (User Mind + open-loop follow-ups) and feel-safe token optimization ship **together**. Do not merge to `main` until the checklist in §8–9 passes and migrations `020` + `021` are ready. Mark the PR ready only when deploying.

Engineering guardrails for Mauri token/latency work.  
**Goal:** cut cost and speed up replies **without** making Mauri feel like a generic chatbot.

Core principle:

> Optimize **transport** (how much you send to Gemini), not **soul** (what Mauri knows and how it sounds).

---

## 1. Non-negotiables (never ship without these)

Every conversational reply path (`generateConversationalReply`) must include:

| Layer | Required | Why users feel connected |
|-------|----------|---------------------------|
| **First name** | Yes | "Morning Ravin" vs "Hello user" |
| **Archetype** | Yes | Student / Corporate / Entrepreneur tone |
| **Voice guardrails** | Yes | No bullets, no "As an AI", short paragraphs, empathy first on stress |
| **User Mind snapshot** | Yes when available | Pre-built understanding — the "mate who knows you" layer |
| **Semantic memories** | Yes on personal/emotional messages | Continuity across days |
| **Latest user message** | Yes | Obvious, but never drop |
| **Empathy-first rule** | Yes in prompt | Stress before spreadsheets |

Proactive features that define feel (do **not** disable for margin):

- 7 AM morning brief (`LocalBuzz`, tags, weather, traffic)
- Open-loop follow-ups (gentle check-ins)
- Memory resurfacing (opt-out only)
- Urgent local alerts (school / weather)
- Voice note transcription (same loop as text)

---

## 2. Soul layer — minimum content per reply

### User Mind (when `user_mind_snapshots` exists)

Include **all** formatted fields from `formatUserMindForPrompt`:

- `life_summary`
- `personality_notes`
- `money_pattern`, `habit_pattern`, `emotional_pattern`
- `active_goals`, `recent_wins`, `open_loops`
- `advice_preferences`, `things_to_avoid`

**Do not** truncate mind snapshot below ~350 tokens without product sign-off.

If mind is missing (new user), fall back to: name + archetype + recent logs + memories — never an empty prompt.

### Semantic memories

| Scenario | Minimum |
|----------|---------|
| Default chat | **2** relevant memories when similarity ≥ 0.55 |
| Emotional / vent / stress keywords | **3** memories (include `insight_memory` when available) |
| Pure factual Q ("what is X") | **0–1** OK |

Current cap: **6** total (`memory.service.ts`). **Do not reduce below 3** for emotional messages.

### Fresh context (same-day)

| Source | Min rows | Max rows (optimization ceiling) |
|--------|----------|----------------------------------|
| Pending todos | 0 | 5 |
| Finance logs | 0 | 5 |
| Habit logs | 0 | 5 |
| Emotional logs | 0 | 3 |

Prefer **summarized lines** over raw JSON when optimizing — e.g. one runway line instead of 10 finance objects.

---

## 3. Output constraints (WhatsApp-native feel)

| Rule | Value |
|------|-------|
| **Default max words** | 120 |
| **Max words (vent / emotional)** | 160 |
| **Max paragraphs** | 3 |
| **Lists / bullets** | Never in user-facing replies |
| **Numbered steps** | Never unless user explicitly asked for a list |
| **Currency** | `Rs` for Mauritius |
| **Languages** | EN / FR / Kreol mix natural to user |

Prompt line to keep in all reply generators:

```
If the user shared stress, respond with empathy first.
Honor advice_preferences and things_to_avoid from the pre-built understanding when present.
```

---

## 4. Safe to optimize (transport)

These reduce tokens **without** hurting feel if soul layer stays intact:

| Optimization | Safe? | Notes |
|--------------|-------|-------|
| Remove rolling full chat history | ✅ | Already not used — keep it that way |
| Cap finance/habit rows to 5 | ✅ | Summarize if more needed |
| Precompute payday runway (1 line) | ✅ | "Runway: Rs X till day 25" |
| Merge extract + reply into 1 Gemini call | ✅ | If extraction quality unchanged |
| Gemini context caching (static system + mind) | ✅ | Cache soul, not user message |
| Skip extraction on obvious Q&A | ✅ | "What's the capital of…" — no finance parse |
| Shorter JSON in prompt | ✅ | Use prose summary helper |
| Faster model (Flash) | ✅ | If evals pass feel bar |

---

## 5. Red lines (do not ship)

| Change | Why it kills feel |
|--------|-------------------|
| Drop User Mind from chat prompt | Amnesiac mate |
| Zero semantic memories on vents | "You forgot" |
| Generic system prompt only | ChatGPT clone |
| Remove empathy-first rule | Cold bot |
| Disable follow-ups / brief / alerts | No "shows up" |
| `phone_number` parallel state tables duplicating `users` | Bugs + stale context |
| Reply max &lt; 40 words default | Telegram bot, not mate |
| Second-class trial users (thinner context) | Bad conversion |

---

## 6. Latency budget (target)

| Step | Budget |
|------|--------|
| Supabase parallel reads | &lt; 200ms p95 |
| Gemini calls | **1** preferred, **2** max |
| Total webhook → reply sent | **&lt; 2.5s** p95 (stretch: 2s) |

If merging extract + reply saves 400ms without quality loss → do it.

---

## 7. Token budget (target per inbound message)

Rough ceilings for **chat reply** prompt (not including model output):

| Block | Target tokens |
|-------|----------------|
| System + voice rules | 150 |
| User profile | 50 |
| User Mind snapshot | 400 |
| Fresh context (summarized) | 250 |
| Semantic memories | 200 |
| Extraction + user message | 150 |
| **Total input** | **~1,200** (soft cap 1,500) |

If over 1,500: trim raw logs first, **never** mind or emotional memories first.

---

## 8. Merge gate (draft PR #12)

Before marking PR #12 **ready for review** and merging to `main`:

- [ ] Token/latency optimization pass completed on this branch (§4 safe items)
- [ ] User Mind + open-loop follow-ups still enabled (§1 non-negotiables)
- [ ] Migrations `020_user_mind_snapshots.sql` + `021_open_loop_follow_ups.sql` scripted for deploy
- [ ] All items in §8 PR review checklist below
- [ ] All five manual feel tests in §9 pass

**Do not merge connection features without feel-safe optimization, or optimization that strips soul.**

---

## 9. PR review checklist

Before merging any context/prompt/LLM optimization PR:

- [ ] User Mind still injected when snapshot exists
- [ ] `advice_preferences` / `things_to_avoid` still in prompt
- [ ] Semantic memory search still runs on chat path
- [ ] Emotional messages still get ≥ 3 memories (or documented exception)
- [ ] Voice guardrails unchanged (no bullets, empathy first)
- [ ] Output word cap documented and enforced
- [ ] No new duplicate state tables (`user_states` etc.) without migration plan
- [ ] Tests pass + at least 1 manual vent scenario sounds warm
- [ ] p95 latency not regressed &gt; 20%
- [ ] Token estimate logged or documented in PR

---

## 9. Manual feel tests (5 minutes)

Run these in staging after optimization changes:

### Test A — Vent
**User:** *"Exams next week and I'm not ready. Can't focus."*  
**Pass:** Empathy first, references archetype or past study context if available, one small next move, no lecture.

### Test B — Memory
**Setup:** User mentioned job interview 2 days ago.  
**User:** *"Nervous about tomorrow."*  
**Pass:** Connects to interview without user re-explaining.

### Test C — Money + mood
**User:** *"Spent too much this weekend. Can I go out Friday?"*  
**Pass:** Acknowledges guilt + practical answer using spend context, not generic budgeting.

### Test D — General Q
**User:** *"What's a good study technique?"*  
**Pass:** Useful answer, lightly tailored to Student Grind if applicable.

### Test E — Kreol mix
**User:** *"Mo stress la, pas kapav dormi."*  
**Pass:** Natural response in mixed/local tone, not robotic translation.

**Fail any test → do not ship optimization.**

---

## 10. Metrics (feel + margin)

Track weekly:

| Metric | Feel signal | Margin signal |
|--------|-------------|---------------|
| D1 / D3 / D7 retention (trial) | ↑ better feel | — |
| Messages per active user per day | ↑ engagement | — |
| Trial → paid conversion | ↑ value felt | — |
| "Refund / same as free AI" support themes | ↓ | — |
| Avg input tokens per reply | — | ↓ |
| Gemini calls per inbound message | — | ↓ toward 1 |
| p95 webhook latency | ↓ | ↓ |

**Optimize margin only when feel metrics are flat or improving.**

---

## 11. One-line approval rule

> If a change makes replies **faster or cheaper** but a trial user would say *"it forgot me"* or *"sounds like ChatGPT"* — **revert**.

---

## Related code

- Chat reply: `src/services/ai.service.ts` → `generateConversationalReply`
- Context load: `src/services/context.service.ts` → `loadUserContext`
- Mind format: `src/services/user-mind-prompt.ts` → `formatUserMindForPrompt`
- Memory search: `src/services/memory.service.ts` → `searchRelevantMemories`
- Off-peak mind: `src/services/user-mind.service.ts`
- Follow-ups: `src/services/open-loop-follow-up.service.ts`
