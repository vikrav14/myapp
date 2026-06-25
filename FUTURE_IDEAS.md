# Future ideas (not scheduled)

Parking lot for product concepts worth revisiting later. Nothing here is committed to the roadmap or PR #12.

---

## Deep Think — multi-model deliberation (deferred)

**Status:** Future idea · **Priority:** TBD · **Target:** post–PR #12, if ever

### Original concept

User asks a question → Gemini replies → Claude also weighs in (agrees or proposes alternatives) → user can respond → loop continues until **two AIs agree and the user agrees**.

### Why it was deferred

- **WhatsApp UX:** open debate threads get long, slow, and feel like homework—not a mate.
- **Cost/latency:** 3–8 model calls per question fights the feel-safe 1-call chat optimization.
- **Positioning:** visible “AI panel” risks making Mauri feel like a meta-ChatGPT product, not a lifestyle companion.
- **Consensus ≠ correctness:** models can agree on weak advice; user sign-off matters more than model agreement.
- **Scope:** User Mind, open-loop follow-ups, and deploy prep are higher priority first.

### Recommended Mauri-shaped version (if built later)

Do **not** wire into the default reply path. Ship as an **opt-in mode** for high-stakes questions only.

**Trigger examples**

- Explicit: `think this through`, `second opinion`, `deep think`
- Offered (not auto-run): Mauri detects job / money / relationship / exam-stress intent and asks *"Want me to pressure-test this?"*

**Flow (2–3 calls, one clean WhatsApp message)**

1. **Primary (Gemini, Mauri voice)** — answer using User Mind + memories + fresh context.
2. **Critic (Claude or second pass)** — structured JSON only: `agree | disagree | alternative | confidence | risks`.
3. **Synthesis (Gemini, Mauri voice)** — single reply: aligned read, nuance, one recommended next move, ask user to confirm.

**Stop rule:** user says yes / good / that works — **not** “two models agreed without user.”

**Never show** “Claude said / Gemini said” unless the user asks. One Mauri voice outward.

### Example output shape

```text
I pressure-tested this with a second lens. Here's where we land:

Both reads say don't rush purely for salary — your stress pattern spikes when
commute eats your evenings.

Suggested move: ask for a decision deadline in writing before you sign.
Reply yes if this fits, or tell me what I'm missing.
```

### Open questions before build

- [ ] Which critic model(s)? Claude API key, cost, and failover if unavailable.
- [ ] Gating: trial limit per week vs paid unlimited?
- [ ] Intent classifier for “offer deep think” vs always explicit opt-in.
- [ ] Liability copy for health / legal / financial topics.
- [ ] Metrics: retention and refund themes, not “users love two AIs.”
- [ ] Does critic get full User Mind or a redacted subset?

### Prerequisites

- PR #12 merged and stable (User Mind + follow-ups live).
- Feel tests passing in production.
- Baseline chat path stable at ~1 Gemini call for normal messages.

### Related code (today)

- Chat reply: `src/services/ai.service.ts` → `resolveConversationalAiResponse`
- Context: `src/services/context.service.ts` → `loadUserContext`
- User Mind: `src/services/user-mind.service.ts`
- Guardrails: `FEEL_SAFE_OPTIMIZATION.md`

### References

- Product discussion: multi-AI deliberation vs Memorae-style single reply (2026-06).
- Competitor context: Memorae = memory + reminders; Mauri edge = knowing you + showing up—not an AI committee.
