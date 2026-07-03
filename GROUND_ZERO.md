# Mauri ground zero checklist

Use this after merging to `main` and before calling production "live".

## 1. GitHub / code

- [ ] `main` includes merged drafts: User Mind, Sunday feedback, WhatsApp reactions, interactive buttons
- [ ] `npm install && npm test` passes locally
- [ ] Remaining draft branches (proactive check-ins, custom squad pacts) tracked as follow-up — they conflict with User Mind facts and need a dedicated merge pass

## 2. Supabase migrations (run in order)

Run every file in `supabase/migrations/` through **021** in the Supabase SQL Editor:

| # | File |
|---|------|
| 001–013 | Core, payments, memory, morning brief |
| 014–015 | Engagement, squad pacts |
| 016–017 | Reminders, calendar, memory resurfacing |
| 018 | Payday + receipts |
| 019 | Local alerts |
| 020 | Weekly report feedback |
| 021 | User Mind facts (`user_mind_facts`) |

Verify:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expect `user_mind_facts`, `weekly_report_feedback`, `scheduled_reminders`, etc.

## 3. Render access

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Open service **mauri-backend** (or create from `render.yaml` Blueprint)
3. Confirm **Settings → Build & Deploy**:
   - Branch: `main`
   - Auto-Deploy: On
   - Health check: `/ready`
4. **Environment** tab — every `sync: false` secret from `render.yaml` must be set (see `.env.production.example`)

### Required secrets (minimum to function)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Database |
| `SUPABASE_SERVICE_ROLE_KEY` | Database writes |
| `GOOGLE_AI_API_KEY` | Gemini chat + transcription |
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify |
| `WHATSAPP_ACCESS_TOKEN` | Send/receive WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta API phone ID |
| `INTERNAL_ADMIN_API_KEY` | Admin panel |
| `PAYMENT_CALLBACK_BASE_URL` | `https://<your-render-url>` no trailing slash |

### Post-deploy URL checks

Replace `<HOST>` with your Render URL:

```bash
curl -s https://<HOST>/ready | jq .
curl -s -H "x-mauri-admin-key: $INTERNAL_ADMIN_API_KEY" https://<HOST>/internal/admin/deploy-preflight | jq .
curl -s https://<HOST>/health
```

Expect `ready: true` and deploy-preflight with no critical failures.

## 4. Meta WhatsApp webhook

In [Meta Developer Console](https://developers.facebook.com/) → WhatsApp → Configuration:

| Field | Value |
|-------|-------|
| Callback URL | `https://<HOST>/webhooks/whatsapp` |
| Verify token | Same as `WHATSAPP_VERIFY_TOKEN` |
| Subscribed fields | `messages` |

Send a test message from your phone → check Render logs for `Processed inbound WhatsApp message`.

## 5. Smoke test (real phone)

1. Message Mauri: `hi`
2. Complete know-you → pick lane → confirm tags
3. Send brain dump: `spent 200 on lunch`
4. Send voice note (optional)
5. Send receipt photo (if `RECEIPT_SCAN_ENABLED=true`)
6. Reply `help` — command menu returns
7. Reply `what do you know about me` — User Mind profile

## 6. Cron jobs (Render)

Confirm these are enabled in logs on startup (see `src/index.ts`):

- Morning brief scrape / curate / deliver (4:30 / 5:00 / 7:00 Mauritius)
- Reminder delivery (`* * * * *`)
- Outbound retry (`*/5 * * * *`)
- Local alerts (if enabled)
- Squad nudges + Sunday showdown

## 7. Admin panel

Open `https://<HOST>/internal/admin/panel` → enter `INTERNAL_ADMIN_API_KEY`.

Check:

- Users list loads
- Deploy preflight tab — green checks for WhatsApp, Supabase, Gemini
- Outbound queue — no stuck `failed` messages after test send

## 8. What's merged vs deferred

### Merged in this consolidation

- User Mind know-you onboarding + My Own Mix lane
- Sunday report "From Mauri" feedback
- WhatsApp reactions (emoji ack)
- WhatsApp interactive list buttons (lane + tags)

### Deferred (next merge — architecture conflict)

- `cursor/proactive-checkins-bb83` — proactive mate pings
- `cursor/custom-squad-pacts-bb83` — custom squad goals
- `cursor/user-mind-snapshots-bb83` — snapshot-based user mind (conflicts with facts table)

These branches replace the facts-based User Mind with snapshots. Merge them in a dedicated PR after reconciling both models.

## 9. Quick rollback

If deploy breaks:

1. Render → **Manual Deploy** → previous successful build
2. Or revert merge commit on `main` and redeploy
3. Check `outbound_messages` and `dead_letter_events` in admin panel
