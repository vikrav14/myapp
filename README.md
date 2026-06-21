# Mauri Backend

Mauri is a WhatsApp-native AI lifestyle companion for Mauritians.

This repository now contains the first backend foundation for the product spec in `mauri_architecture.md`. It is a TypeScript Node.js service that accepts WhatsApp webhook events, loads context from Supabase, extracts structured personal data with Gemini, persists the logs, and generates a conversational reply.

## What is implemented

- Express server with health check and WhatsApp webhook endpoints
- Supabase migration for users, finance, habits, todos, insights, and squads
- Onboarding flow for archetype selection with 7-day trial activation
- Trial expiry enforcement with locked-state paywall response
- Payment confirmation endpoint with subscription activation and payment event logging
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
  schemas/extraction.ts     Mauri parser schema
  services/ai.service.ts    Gemini extraction + reply generation
  services/context.service.ts
  services/logging.service.ts
  services/onboarding.service.ts
  services/payment.service.ts
  services/user.service.ts
  services/whatsapp.service.ts
supabase/migrations/
  001_init_mauri.sql
  002_onboarding_and_subscription_state.sql
  003_payment_activation.sql
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
```

## Webhook contract

The webhook route supports:

- direct JSON payloads shaped like `{ "from": "...", "text": "..." }`
- standard Meta WhatsApp webhook payloads with `entry -> changes -> value -> messages`

There is also a secured internal payment confirmation route:

- `POST /internal/payments/confirm`
- requires header `x-mauri-admin-key: <INTERNAL_ADMIN_API_KEY>`
- accepts `userId` or `phoneNumber`, plus `provider`, `transactionReference`, `amount`
- records the payment event
- flips the user to `Paid_Active`
- stamps `subscription_started_at`, `subscription_ends_at`, and `last_payment_at`
- optionally sends the unlock confirmation message back to WhatsApp

## Current lifecycle behavior

New users are created in `awaiting_archetype`.

Their first valid archetype selection activates onboarding, stamps the trial window, and switches them into the normal Mauri conversation loop.

When `trial_ends_at` is in the past and the user is still `Trial_Active`, the webhook auto-locks the account and returns a premium unlock message instead of running extraction and reply generation.

When a payment confirmation is posted to the internal payment route, the user is unlocked into `Paid_Active` and receives a premium expiry window.

When a paid subscription window expires, the webhook auto-locks the account again on the next inbound message.

## Current constraints

This is the backend foundation, not the final production system.

Voice-note transcription, Sunday diagnostic report generation, provider-specific Juice/Blink callback adapters, embedding generation, and vector similarity search are still the next layer to build.
