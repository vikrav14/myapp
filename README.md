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
- Structured extraction pipeline for finance, todos, habits, and emotions
- Context-aware reply generation with Mauri voice guardrails
- Silent persistence into the relevant storage tables
- Scheduled squad nudges at 15:00 and Sunday showdown runs at 20:30
- Environment template for local setup

## Project structure

```text
src/
  index.ts                  Server bootstrap
  jobs/squad-jobs.ts        Afternoon nudges + Sunday showdown
  lib/env.ts                Runtime environment validation
  lib/logger.ts             Application logging
  lib/supabase.ts           Supabase client
  routes/whatsapp.ts        Webhook verification + inbound processing
  routes/reports.ts         Internal weekly diagnostic generation
  schemas/extraction.ts     Mauri parser schema
  services/ai.service.ts    Gemini extraction + reply generation
  services/context.service.ts
  services/logging.service.ts
  services/onboarding.service.ts
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

## Supabase setup

Run the migration file in Supabase SQL Editor:

```text
supabase/migrations/001_init_mauri.sql
supabase/migrations/002_onboarding_and_subscription_state.sql
supabase/migrations/003_payment_activation.sql
supabase/migrations/004_weekly_reports.sql
supabase/migrations/005_voice_note_transcriptions.sql
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

There is also a secured internal payment confirmation route:

- `POST /internal/payments/confirm`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`, plus `provider`, `transactionReference`, `amount`
- records the payment event
- flips the user to `Paid_Active`
- stamps `subscription_started_at`, `subscription_ends_at`, and `last_payment_at`
- optionally sends the unlock confirmation message back to WhatsApp

There is also a secured weekly report generation route:

- `POST /internal/reports/weekly`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`
- can optionally send the report to WhatsApp
- stores the report text and computed weekly summary in `weekly_reports`

## Current lifecycle behavior

New users are created in `awaiting_archetype`.

Their first valid archetype selection activates onboarding, stamps the trial window, and switches them into the normal Mauri conversation loop.

When `trial_ends_at` is in the past and the user is still `Trial_Active`, the webhook auto-locks the account and returns a premium unlock message instead of running extraction and reply generation.

When a payment confirmation is posted to the internal payment route, the user is unlocked into `Paid_Active` and receives a premium expiry window.

When a paid subscription window expires, the webhook auto-locks the account again on the next inbound message.

Every Sunday at 19:30, Mauri generates a private weekly diagnostic for active users and stores the report payload in `weekly_reports`.

## Current constraints

This is the backend foundation, not the final production system.

Provider-specific Juice/Blink callback adapters, embedding generation, and vector similarity search are still the next layer to build.
