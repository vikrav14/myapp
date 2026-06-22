# Mauri deployment guide

This project is ready for container deployment.

## Recommended runtime

- Render web service with the included `render.yaml`
- Supabase for PostgreSQL and pgvector
- Meta WhatsApp Business API
- Google Gemini API

## Before deploy

Run all SQL migrations in Supabase SQL Editor:

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

## Critical environment variables

Must be configured before production traffic:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_AI_API_KEY`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `INTERNAL_ADMIN_API_KEY`
- `PAYMENT_CALLBACK_BASE_URL`
- `PAYMENT_RETURN_URL`
- `METRICS_IP_ALLOWLIST`

Strongly recommended in production:

- `PEACH_ENTITY_ID`
- `PEACH_WEBHOOK_SECRET`
- `ADMIN_IP_ALLOWLIST`
- `PAYMENT_WEBHOOK_IP_ALLOWLIST`
- `WHATSAPP_WEBHOOK_IP_ALLOWLIST`
- `TRUST_PROXY=true`
- `ENABLE_SECURITY_HEADERS=true`
- alert thresholds tuned for expected volume
- `ALERT_WEBHOOK_URL` if you want external paging for operational alerts

Provider-specific if enabled:

- `MCB_JUICE_CALLBACK_TOKEN`
- `BLINK_CALLBACK_TOKEN`
- `MCB_JUICE_PAYMENT_LINK`
- `BLINK_PAYMENT_LINK`

## Container deployment

The repository includes:

- `Dockerfile`
- `.dockerignore`
- `render.yaml`

Local container smoke test:

```bash
docker build -t mauri-backend .
docker run --rm -p 3000:3000 --env-file .env mauri-backend
```

## Render notes

The included `render.yaml` uses:

- Docker runtime
- `/ready` as the health check
- environment variable placeholders for all required production settings

If you deploy on Render:

1. create the service from the repository
2. review every env var in `render.yaml`
3. set all secrets in Render dashboard
4. confirm `/ready` returns 200 after deploy

## Verification checklist

After deploy, confirm:

- `GET /health` returns 200
- `GET /ready` returns 200
- `GET /metrics` returns Prometheus-formatted output from an allowed IP
- `GET /internal/admin/security-posture` shows expected production settings
- `GET /internal/admin/alerts` returns current alert state
- `GET /internal/admin/panel` loads in browser
- `POST /internal/admin/alerts/evaluate` opens alerts when thresholds are exceeded
- alert webhook receives payloads when `ALERT_WEBHOOK_URL` is configured
- WhatsApp webhook verification succeeds
- a test outbound message lands in `outbound_messages`
- retry loop cron runs as expected

## Security checklist

Before opening production traffic:

- configure `ADMIN_IP_ALLOWLIST`
- configure `PAYMENT_WEBHOOK_IP_ALLOWLIST`
- configure `WHATSAPP_WEBHOOK_IP_ALLOWLIST`
- configure `METRICS_IP_ALLOWLIST`
- configure `PEACH_WEBHOOK_SECRET`
- rotate `INTERNAL_ADMIN_API_KEY` away from defaults
- keep the Supabase service role key server-side only

## CI

GitHub Actions runs:

- `npm ci`
- `npm run build`
- `npm run typecheck`
- `npm run test`

on pushes and pull requests.
