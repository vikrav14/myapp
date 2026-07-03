# Mauri ground zero checklist

Use this after merging to `main` and before calling production "live".

## 1. GitHub / code

- [ ] `main` includes all draft features (see table below)
- [ ] `npm install && npm test` passes locally (**180 tests**)

### What's on `main`

| Feature | Source PR / branch |
|---------|-------------------|
| User Mind facts + know-you onboarding | #19 / user-mind-know-you |
| My Own Mix custom lane | #19 |
| Sunday report feedback | sunday-report-feedback |
| WhatsApp reactions + interactive buttons | reactions / interactive branches |
| Wide-door onboarding copy | #18 (cherry-picked) |
| Custom squad pacts | #13 |
| Off-peak User Mind snapshots | user-mind-snapshots |
| Open-loop follow-ups | open-loop in snapshots branch |
| Proactive mate check-ins | #14 |

**Dual User Mind model (nothing lost):**

- `user_mind_facts` — what the user *tells* you (know-you, remember/forget)
- `user_mind_snapshots` — what Mauri *learns* nightly from logs + chat

Both feed into replies.

## 2. Supabase migrations (run in order)

Through **025**:

| # | File |
|---|------|
| 001–019 | Core through local alerts |
| 020 | `weekly_report_feedback.sql` |
| 021 | `user_mind.sql` (facts) |
| 022 | `squad_custom_pact_weights.sql` |
| 023 | `user_mind_snapshots.sql` |
| 024 | `open_loop_follow_ups.sql` |
| 025 | `proactive_checkins.sql` |

## 3. Render access

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Deploy **vikrav14/myapp** from `main` (new service if `mauri-backend.onrender.com` is wrong app)
3. Set all secrets from `render.yaml` + `.env.production.example`
4. Verify: `curl https://<HOST>/ready`

## 4. Meta WhatsApp webhook

`https://<HOST>/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`

## 5. Smoke test

1. `hi` → know-you → lane → tags
2. `what do you know about me` (facts)
3. `squad goal custom Exam sprint — focus study todos`
4. `followups on` / `my checkins`
5. Receipt photo + voice note

## 6. Cron jobs (auto-registered)

| Time (Mauritius) | Job |
|------------------|-----|
| 02:00 | User Mind snapshot reflection |
| 10:00 | Open-loop follow-up delivery |
| 16:00 | Proactive mate check-ins |
| 07:00 | Morning brief |
| 15:00 / 20:30 | Squad nudges / Sunday showdown |

## 7. Admin panel

`https://<HOST>/internal/admin/panel`

Manual triggers:

- `POST /internal/admin/user-mind/reflect`
- `POST /internal/admin/open-loop-followups/deliver`
- `POST /internal/admin/proactive-checkins/deliver`
