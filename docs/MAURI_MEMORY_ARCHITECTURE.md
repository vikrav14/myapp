# Mauri Memory Architecture

**Purpose:** Canonical map of what users say → where it lives → who reads it.  
**Audience:** Product + engineering before building report UI or unified router.  
**Principle:** Non-robotic reports require **complete memory** upstream — not better templates downstream.

---

## 1. The three memory layers

Mauri does not have one database of “what we know.” It has **three layers** with different jobs:

| Layer | Table(s) | What it holds | Analogy |
|-------|----------|---------------|---------|
| **Profile facts** | `user_mind_facts` | Stable truths the user told us | Identity card |
| **Structured logs** | `finance_logs`, `habit_logs`, `todo_logs`, `insights_vault` | Measurable events in time | Ledger |
| **Living reflection** | `user_mind_snapshots`, `conversation_memories` | Inferred patterns + full chat history | Journal + search index |

Plus **derived state** on `users` (archetype, help focus, weekly focus, modules, topics) — rule-inferred from facts at onboarding, updatable via commands.

```
                    ┌──────────────────────┐
   User says ──────►│  INBOUND ROUTER      │
                    │  (rules today;       │
                    │   unified AI next)   │
                    └──────────┬───────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
  user_mind_facts      structured logs        conversation_memories
  (profile)            (events)               (every message)
         │                     │                     │
         │                     └──────────┬──────────┘
         │                                ▼
         │                     user_mind_snapshots (nightly AI)
         │                                │
         └────────────────┬───────────────┘
                          ▼
              CONSUMERS (report, reply, brief, nudges)
```

---

## 2. Canonical schema: utterance → storage → consumer

### 2.1 Profile facts (`user_mind_facts`)

| Category | Examples | Written when | Consumers |
|----------|----------|--------------|-----------|
| `identity` | age, age_band | Know-you, `remember that` | Replies, report narrative, inference |
| `location` | Vacoas, Grand Baie commute | Know-you, remember | Morning pulse label, local advice |
| `life_context` | management company, side hustle | Know-you, remember | Express setup, modules, report story |
| `interests` | digital marketing | Know-you, remember | Report, advice lens |
| `goals` | break 9–5, side hustle at night | Know-you, remember | Weekly focus, proactive check-ins, report |
| `stressors` | wedding loan, brain fried 8pm | Know-you, remember | Life threads, help focus, report |
| `relationships` | dad laid off, parents expect payment | Know-you, remember | Life threads, relationship lens |
| `preferences` | tone, how to show up | Know-you, remember | All AI copy guardrails |
| `boundaries` | no guilt trips | Know-you, remember | Advice, proactive tone |
| `user_stated` | freeform remember | `remember that` only | Replies |

**Writer:** `extractUserMindProfile` (AI) → `extractionToFactRows` (rules) → upsert.  
**Not written from:** casual chat (gap).

---

### 2.2 Structured logs

| Store | Schema keys | Written when | Consumers |
|-------|-------------|--------------|-----------|
| `finance_logs` | amount, category, context_tags, raw_source_text | Brain-dump extraction; receipt scan; finance commands | Report aggregates, runway, roast/hype snapshot, reflection |
| `habit_logs` | activity_type, duration_minutes, is_success | Brain-dump extraction | Report, streaks, squad, reflection |
| `todo_logs` | task_description, due_date, priority, is_completed | Brain-dump extraction (create only today) | Report counts, reminders, reflection |
| `insights_vault` | anxiety_score, core_emotional_driver, raw_unfiltered_vent, embedding | Brain-dump emotions; morning mood | Report mood stats; semantic search; **vent text not in report** |

**Writer:** `extractStructuredContext` (AI) → `persistExtraction` (rules).  
**Runs on:** every conversational message (no skip wired yet).

---

### 2.3 Conversation & reflection

| Store | Written when | Consumers |
|-------|--------------|-----------|
| `conversation_memories` | Every user message + assistant reply (embedding) | `loadUserContext` semantic search; resurfacing cron |
| `user_mind_snapshots` | Nightly 02:00 if signal in 7-day window | Replies, proactive check-ins, open-loop scheduling; **not report today** |

Snapshot fields: `life_summary`, `money_pattern`, `habit_pattern`, `emotional_pattern`, `active_goals[]`, `recent_wins[]`, `open_loops[]`, `advice_preferences`, `things_to_avoid[]`.

---

### 2.4 Proactive threads

| Store | Source | Consumers |
|-------|--------|-----------|
| `open_loop_follow_ups` | Life threads at onboarding (regex on facts); snapshot `open_loops[]` nightly | Gentle follow-up messages |
| `proactive_checkins` | Rule candidates + AI message | Mate check-ins |
| `scheduled_reminders` | User `remind me` | Delivery cron; reflection input only |

---

### 2.5 Reports & feedback

| Store | Written when | Consumers |
|-------|--------------|-----------|
| `weekly_reports` | Sunday 19:30 UTC cron | WhatsApp text + PNG card; **future web report** |
| `summary_json` | Same | Momentum, finance/habit/todo/emotion aggregates |
| `service_feedback` | Sunday rating / `mauri feedback` | Product tuning; **not facts** |

---

### 2.6 Derived `users` columns (not utterance store — inferred)

| Field | Inferred from | Consumers |
|-------|---------------|-----------|
| `archetype`, `brief_focus` | Facts at express setup | Morning brief framing |
| `active_modules[]` | Facts | Activation copy, module commands |
| `topic_preferences[]` | Facts + archetype | 7am brief tags |
| `help_focus_primary/secondary` | Facts; user can change | Advice lens on every reply |
| `weekly_focus_habit` | Facts + archetype | Activation, proactive useful mode |
| `payday_day_of_month`, `monthly_income_rs` | Finance commands | Runway |

---

## 3. Routing today: rules first, AI inside

```
WhatsApp inbound
  → parseInboundMessage
  → enforceAccessPolicy (locked/trial)
  → resolveInboundMessageText (voice → transcript)
  → COMMAND CHAIN (first match wins, all rule-based):
       pay → help focus → engagement → onboarding → user mind commands
       → service feedback → finance → followups → modules → …
  → CONVERSATIONAL FALLBACK:
       loadUserContext (facts + snapshot + logs + semantic memories)
       storeConversationMemory (user)
       extractStructuredContext (AI) → persistExtraction
       generateConversationalReply (AI)
       storeConversationMemory (assistant)
```

**AI does not pick the path.** Two separate AI extractors run only after rules send traffic somewhere:

| Extractor | Trigger | Output |
|-----------|---------|--------|
| `extractUserMindProfile` | Know-you, `remember that` | Profile facts |
| `extractStructuredContext` | Every chat message | finance / habits / todos / emotions |

---

## 4. Consumer matrix (who reads what)

| Consumer | Facts | Logs | Snapshot | Memories | summary_json |
|----------|-------|------|----------|----------|--------------|
| Conversational reply | ✅ | ✅ recent | ✅ | ✅ semantic | ❌ |
| Sunday report text | ✅ prompt | ✅ week | ❌ | ❌ | ✅ |
| Sunday PNG card | ❌ | ✅ week | ❌ | ❌ | ✅ |
| Morning 7am brief | ❌ | ❌ | ❌ | ❌ | ❌ |
| Roast / hype | ❌ | ✅ rolling 7d | ❌ | ❌ | ❌ |
| Proactive check-in | ✅ | ✅ | ✅ | ❌ | ❌ |
| Open-loop follow-up | partial | ❌ | ✅ loops | ❌ | ❌ |
| Advice engine | ✅ lens | ✅ | ✅ | ✅ | ❌ |

**Morning brief is intentionally amnesiac** about personal story — privacy product rule.

**Sunday report is half-blind** — ignores snapshot and conversation. Primary fix for “robotic.”

---

## 5. Known gaps (honest)

| Gap | Impact |
|-----|--------|
| Chat doesn’t update facts | Mid-week life changes lost unless `remember that` |
| Report ignores snapshots | Rich inference unused on Sunday |
| `raw_unfiltered_vent` not in report | Mood score only, not story |
| Roast/hype ≠ report week window | Different time ranges |
| Todo completion not wired | “done X” doesn’t close todos |
| `storeFreeformUserMindFact` unused | No lightweight fact append |
| 13→10 list row bug | Fixed; pattern of “WhatsApp limits vs data model” |
| No unified router | Two extractors + amnesia after onboarding |

---

## 6. Design principles (for report + router work)

1. **AI proposes, code commits** — structured writes validated before DB.
2. **Typed escape hatches** — every interactive beat allows plain text / voice.
3. **Same week, same story** — report, roast, hype, web link share one `week_id`.
4. **Measurable when possible, honest when quiet** — ghost weeks don’t fake graphs.
5. **Profile deltas are visible** — material fact changes get a one-line ack (“Got it — updated how I read your money pressure.”).

---

*Next doc: `MESSAGE_ROUTER_SPEC.md` — unified router contract and rollout.*
