# Mauri Backend

Mauri is a WhatsApp-native AI lifestyle companion for Mauritians.

This repository now contains the first backend foundation for the product spec in `mauri_architecture.md`. It is a TypeScript Node.js service that accepts WhatsApp webhook events, loads context from Supabase, extracts structured personal data with Gemini, persists the logs, and generates a conversational reply.

## What is implemented

- Express server with health check and WhatsApp webhook endpoints
- Supabase migration for users, finance, habits, todos, insights, and squads
- Onboarding flow for archetype selection with 7-day trial activation
- Trial expiry enforcement with locked-state paywall response
- Payment confirmation endpoint with subscription activation and payment event logging
- Sunday diagnostic report generation with weekly storage and delivery
- Voice note transcription for WhatsApp audio messages
- Embedding-backed semantic memory storage and retrieval
- Provider-specific payment callback adapters for MCB Juice and Blink
- Internal admin and operations API surface
- Request tracing and persistent audit events
- Duplicate inbound WhatsApp event protection
- Structured extraction pipeline for finance, todos, habits, and emotions
- Context-aware reply generation with Mauri voice guardrails
- Silent persistence into the relevant storage tables
- Scheduled squad nudges at 15:00 and Sunday showdown runs at 20:30
- Deployment-ready Docker, Render, and CI configuration
- Environment template for local setup

## Project structure

```text
src/
  index.ts                  Server bootstrap
  jobs/squad-jobs.ts        Afternoon nudges + Sunday showdown
  lib/env.ts                Runtime environment validation
  lib/logger.ts             Application logging
  lib/request-tracing.ts    Request IDs and request lifecycle logs
  lib/supabase.ts           Supabase client
  routes/whatsapp.ts        Webhook verification + inbound processing
  routes/admin.ts           Internal admin and ops endpoints
  routes/reports.ts         Internal weekly diagnostic generation
  schemas/extraction.ts     Mauri parser schema
  services/ai.service.ts    Gemini extraction + reply generation
  services/admin.service.ts
  services/audit.service.ts
  services/context.service.ts
  services/logging.service.ts
  services/memory.service.ts
  services/onboarding.service.ts
  services/dead-letter.service.ts
  services/outbound-message.service.ts
  services/outbound-retry.service.ts
  services/payment-link.service.ts
  services/payment.service.ts
  services/report.service.ts
  services/user.service.ts
  services/voice-note.service.ts
  services/whatsapp.service.ts
supabase/migrations/
  001_init_mauri.sql
  002_onboarding_and_subscription_state.sql
  003_payment_activation.sql
  004_weekly_reports.sql
  005_voice_note_transcriptions.sql
  006_vector_memory.sql
  007_payment_checkout_sessions.sql
  008_audit_events.sql
  009_outbound_messages.sql
  010_dead_letter_events.sql
  011_processed_inbound_events.sql
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_AI_API_KEY`
- `GEMINI_MODEL`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `MCB_JUICE_PAYMENT_LINK`
- `BLINK_PAYMENT_LINK`
- `SUBSCRIPTION_MONTHLY_PRICE_RS`
- `DEFAULT_SUBSCRIPTION_DAYS`
- `INTERNAL_ADMIN_API_KEY`
- `EMBEDDING_MODEL`
- `EMBEDDING_OUTPUT_DIMENSIONS`
- `MCB_JUICE_CALLBACK_TOKEN`
- `BLINK_CALLBACK_TOKEN`
- `PAYMENT_CALLBACK_BASE_URL`
- `PAYMENT_RETURN_URL`
- `PEACH_ENTITY_ID`
- `PEACH_CHECKOUT_URL`
- `BLINK_PAYLINK_API_URL`
- `PEACH_WEBHOOK_SECRET`
- `PEACH_WEBHOOK_TOLERANCE_SECONDS`
- `OUTBOUND_RETRY_MAX_ATTEMPTS`
- `OUTBOUND_RETRY_BASE_DELAY_SECONDS`
- `OUTBOUND_RETRY_CRON`
- `TRUST_PROXY`
- `ENABLE_SECURITY_HEADERS`
- `ADMIN_IP_ALLOWLIST`
- `PAYMENT_WEBHOOK_IP_ALLOWLIST`
- `WHATSAPP_WEBHOOK_IP_ALLOWLIST`

If the WhatsApp send credentials are absent, the service will still process inbound payloads and log the reply instead of attempting delivery.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## CI

GitHub Actions is configured to run:

- `npm ci`
- `npm run build`
- `npm run typecheck`

on pushes and pull requests.

## Deployment

This repository now includes:

- `Dockerfile`
- `.dockerignore`
- `render.yaml`
- `DEPLOYMENT.md`

Recommended next step for production deployment:

- read `DEPLOYMENT.md`
- apply all Supabase migrations
- configure the required environment variables
- deploy the container service
- validate `/ready` and `/internal/admin/security-posture`

## Health and readiness

- `GET /health` checks whether the process is alive
- `GET /ready` checks whether the process can still reach Supabase

## Supabase setup

Run the migration file in Supabase SQL Editor:

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
```

## Webhook contract

The webhook route supports:

- direct JSON payloads shaped like `{ "from": "...", "text": "..." }`
- direct audio payloads shaped like `{ "from": "...", "audioUrl": "...", "mimeType": "audio/ogg" }`
- standard Meta WhatsApp webhook payloads with `entry -> changes -> value -> messages`

When the inbound payload is an audio message, the server:

- downloads the media
- transcribes it with Gemini
- stores the transcript in `voice_note_transcriptions`
- feeds the transcript into the same onboarding, extraction, and reply loop as a typed message

The semantic memory layer stores embedded user messages, Mauri replies, and emotional signals.

When a new message arrives, Mauri can retrieve similar past memories from vector search and inject them into the hidden reply context before generating the response.

Inbound WhatsApp messages with the same `messageId` are now deduplicated before user lookup and downstream processing, which prevents duplicate replies and duplicate logging when webhook deliveries are retried.

There is also a secured internal payment confirmation route:

- `POST /internal/payments/confirm`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`, plus `provider`, `transactionReference`, `amount`
- records the payment event
- flips the user to `Paid_Active`
- stamps `subscription_started_at`, `subscription_ends_at`, and `last_payment_at`
- optionally sends the unlock confirmation message back to WhatsApp

There is also a secured internal admin route surface:

- `GET /internal/admin/overview`
- `GET /internal/admin/panel`
- `GET /internal/admin/users`
- `GET /internal/admin/users/:userId`
- `PATCH /internal/admin/users/:userId`
- `GET /internal/admin/dashboard`
- `GET /internal/admin/security-posture`
- `GET /internal/admin/payment-sessions`
- `GET /internal/admin/outbound-messages`
- `POST /internal/admin/outbound-messages/:messageId/retry`
- `POST /internal/admin/outbound-messages/:messageId/requeue`
- `POST /internal/admin/outbound-messages/:messageId/discard`
- `GET /internal/admin/reports`

These endpoints let you:

- inspect user lifecycle state
- inspect payment sessions and reports
- inspect outbound delivery failures
- inspect audit trails
- review recent user ops activity
- update subscription or onboarding state without direct SQL

The panel route serves a lightweight browser UI that stores the admin API key locally in the browser and uses it to call the existing internal admin JSON endpoints.

Additional admin ops route:

- `GET /internal/admin/audit-events`
- `GET /internal/admin/dead-letters`

This supports filtering by:

- `userId`
- `eventType`
- `severity`
- `requestId`

The dashboard route returns a lightweight HTML operations view showing overview metrics, recent dead letters, recent outbound failures, and recent audit events.

The security posture route returns the live hardening summary, including whether IP allowlists, trust proxy, security headers, and Peach webhook signature verification are configured.

There is also a secured internal payment link/session route:

- `POST /internal/payments/links`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`, plus `provider`, `amount`, and optional `durationDays`
- generates a provider-specific checkout session
- stores a `payment_checkout_sessions` row
- returns provider-ready payload data for Juice or Blink

There are also provider-facing payment callback routes:

- `POST /webhooks/payments/juice`
- `POST /webhooks/payments/blink`

These routes:

- normalize provider payloads into Mauri subscription activations
- ignore non-final or non-successful payment states
- resolve the user from explicit `userId`, `phoneNumber`, or a structured payment reference
- accept duplicate callbacks safely without double-activating the subscription
- optionally validate `x-mauri-provider-token` or `?token=` when the callback token env vars are configured

Reference format supported for user resolution:

- `mauri:user:<uuid>`
- `user:<uuid>`
- `mauri:phone:<digits>`
- `phone:<digits>`
- plain UUID
- plain phone number

For Blink, the generated `transaction_unique` is parseable by Mauri and unique per session.

For MCB Juice, the generated `merchantTransactionId` stays short for Peach constraints, while the full Mauri user reference is stored in `customParameters`.

There is also a secured weekly report generation route:

- `POST /internal/reports/weekly`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`
- can optionally send the report to WhatsApp
- stores the report text and computed weekly summary in `weekly_reports`

## Observability

Every request now gets an `x-request-id`.

The server logs request start and completion with duration and status code.

Major events are also persisted in `audit_events`, including:

- inbound WhatsApp message processing
- voice-note transcription
- payment activation
- payment checkout session creation
- weekly report generation
- admin user updates

Outbound WhatsApp sends are also persisted in `outbound_messages`.

Failed sends are retried automatically on the schedule defined by `OUTBOUND_RETRY_CRON`, with exponential backoff controlled by the retry env vars.

When `PEACH_WEBHOOK_SECRET` is configured, the MCB Juice callback route verifies Peach HMAC webhook signatures before processing payment activations.

Permanently failed outbound messages are also surfaced as `dead_letter_events`, and can be requeued or discarded through the admin ops routes.

## Hardening

The server can enforce route-level IP allowlisting with separate configuration for:

- internal admin and payment routes
- payment provider webhooks
- WhatsApp webhooks

Helmet security headers are enabled by default and can be disabled only through `ENABLE_SECURITY_HEADERS=false`.

When `NODE_ENV=production`, startup warnings are emitted if key hardening controls are missing, such as:

- `TRUST_PROXY`
- admin IP allowlist
- payment webhook IP allowlist
- WhatsApp webhook IP allowlist
- Peach webhook secret

## Current lifecycle behavior

New users are created in `awaiting_archetype`.

Their first valid archetype selection activates onboarding, stamps the trial window, and switches them into the normal Mauri conversation loop.

When `trial_ends_at` is in the past and the user is still `Trial_Active`, the webhook auto-locks the account and returns a premium unlock message instead of running extraction and reply generation.

When a payment confirmation is posted to the internal payment route, the user is unlocked into `Paid_Active` and receives a premium expiry window.

When a paid subscription window expires, the webhook auto-locks the account again on the next inbound message.

Every Sunday at 19:30, Mauri generates a private weekly diagnostic for active users and stores the report payload in `weekly_reports`.

## Current constraints

This is the backend foundation, not the final production system.

The next major integration layers are admin tooling hardening and operational observability.
