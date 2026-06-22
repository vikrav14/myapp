# Mauri deployment guide

This project is ready for container deployment on Render (or any Docker host) with Supabase, Meta WhatsApp, Gemini, Peach Payments (MCB Juice), and Blink.

## 1. Run Supabase migrations

Run every file in order inside the Supabase SQL Editor:

```text
supabase/migrations/001_init_mauri.sql
supabase/migrations/002_onboarding_and_subscription_state.sql
supabase/migrations/003_payment_activation.sql
supabase/migrations/004_weekly_reports.sql
supabase/migrations/005_voice_note_transcriptions.sql
supabase/migrations/006_vector_memory.sql
supabase/migrations/007_payment_checkout_sessions.sql
supabase/migrations/008_audit_events.sql
supabase/migrations/009_outbound_messages.sql
supabase/migrations/010_dead_letter_events.sql
supabase/migrations/011_processed_inbound_events.sql
supabase/migrations/012_operational_alert_states.sql
```

## 2. Deploy the web service (Render)

1. Connect the GitHub repo to Render.
2. Use the included `render.yaml` Blueprint, or create a **Web Service** with:
   - Runtime: **Docker**
   - Dockerfile path: `./Dockerfile`
   - Health check path: `/ready`
3. After the first deploy, copy the public service URL (or attach a custom domain).
4. Set `PAYMENT_CALLBACK_BASE_URL` to that public HTTPS URL **without a trailing slash**.

Example:

```text
PAYMENT_CALLBACK_BASE_URL=https://mauri-backend.onrender.com
PAYMENT_RETURN_URL=https://mauri-backend.onrender.com/payments/return
```

Use `.env.production.example` as the full secret checklist.

## 3. Configure Blink (auto paylinks)

Set in Render env:

| Variable | Purpose |
|----------|---------|
| `BLINK_API_KEY` | Blink API key |
| `BLINK_SECRET_KEY` | Blink secret key |
| `BLINK_CALLBACK_TOKEN` | Shared token appended to callback URL |
| `BLINK_TOKEN_API_URL` | Default UK token endpoint (change only if Blink instructs) |
| `BLINK_PAYLINK_API_URL` | Default paylink endpoint |

Register this callback URL in the Blink dashboard:

```text
https://<your-service>/webhooks/payments/blink?token=<BLINK_CALLBACK_TOKEN>
```

`BLINK_PAYMENT_LINK` is only needed as a manual fallback when API credentials are absent.

## 4. Configure MCB Juice via Peach Payments

Set in Render env:

| Variable | Purpose |
|----------|---------|
| `PEACH_ENTITY_ID` | Peach entity / merchant ID |
| `PEACH_CHECKOUT_SECRET` | Checkout signing secret for `/checkout/initiate` |
| `PEACH_WEBHOOK_SECRET` | HMAC secret for signed payment webhooks |
| `MCB_JUICE_CALLBACK_TOKEN` | Shared token for the Juice callback route |

Register this callback URL in Peach / Juice settings:

```text
https://<your-service>/webhooks/payments/juice?token=<MCB_JUICE_CALLBACK_TOKEN>
```

`MCB_JUICE_PAYMENT_LINK` is only needed as a manual fallback when Peach checkout automation is not configured.

## 5. Configure Meta WhatsApp

Set:

- `WHATSAPP_VERIFY_TOKEN` — must match Meta webhook verification
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Register webhook URL:

```text
https://<your-service>/webhooks/whatsapp
```

Subscribe to `messages` (and any other fields you need).

## 6. Security hardening (required for production)

Set all of these before opening traffic:

| Variable | Notes |
|----------|-------|
| `INTERNAL_ADMIN_API_KEY` | Strong random value; never use the example default |
| `TRUST_PROXY` | `true` on Render |
| `ENABLE_SECURITY_HEADERS` | `true` |
| `ADMIN_IP_ALLOWLIST` | CIDRs allowed to reach `/internal/*` |
| `PAYMENT_WEBHOOK_IP_ALLOWLIST` | Peach/Blink source IPs if known |
| `WHATSAPP_WEBHOOK_IP_ALLOWLIST` | Meta webhook source ranges |
| `METRICS_IP_ALLOWLIST` | Monitoring scraper IPs |

Rotate `SUPABASE_SERVICE_ROLE_KEY` access to server-side only.

## 7. Preflight before go-live

### CLI (local or CI)

```bash
cp .env.production.example .env
# fill secrets, then:
npm run deploy:preflight
```

Exit code `0` means no blocking checks failed.

### Admin API / panel

- `GET /internal/admin/deploy-preflight` (requires `x-mauri-admin-key`)
- Admin panel → **Security posture** → deploy readiness table + provider webhook URLs

Blocking checks include missing public callback URL, default admin key, missing WhatsApp send credentials, and missing payment automation/fallback configuration.

## 8. Post-deploy verification

Confirm:

- `GET /health` → 200
- `GET /ready` → 200
- `npm run deploy:preflight` → exit 0 with production env
- `GET /internal/admin/deploy-preflight` → `ready: true`
- `GET /metrics` → Prometheus text (from allowlisted IP), including HTTP request counters
- Meta webhook verification succeeds
- Test checkout:
  - Admin panel → user → **Generate payment link** (MCB_JUICE and BLINK)
  - Or trigger paywall from a locked test user in WhatsApp
- Payment webhook hits `/webhooks/payments/juice` or `/blink` and activates subscription
- `GET /internal/admin/panel` loads and shows deploy checks green

## 9. Local container smoke test

```bash
docker build -t mauri-backend .
docker run --rm -p 3000:3000 --env-file .env mauri-backend
```

## 10. CI

GitHub Actions runs `npm ci`, `npm run build`, `npm run typecheck`, and `npm run test` on pushes and pull requests.

## Render notes

The included `render.yaml` already declares Docker runtime, `/ready` health checks, Peach/Blink defaults, alert cron settings, and `sync: false` placeholders for secrets. Review every env var in the Render dashboard before enabling production traffic.
