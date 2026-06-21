# 🚀 Project Mauri: System Context & Core Software Architecture
**Version:** 1.0.0 (Production Blueprint)
**Target Platform:** WhatsApp Sandbox / Node.js Server / Supabase PostgreSQL

---

## 1. Product Core Philosophy
Mauri is a hyper-personalized, context-aware AI Lifestyle Companion living natively inside WhatsApp for Mauritians (students, young professionals, entrepreneurs). She acts as a grounded, sharp, and empathetic peer who remembers everything, tracks daily accountability metrics (finance, habits, tasks, mood), and helps users escape daily mental chaos.

### The Behavioral Guardrails:
* **Anti-Bot Formatting:** Never output bulleted lists, rigid numbered steps, or generic AI fluff ("As an AI...", "Great question!"). Speak in short, staccato, punching paragraphs.
* **Hyper-Local Nuance:** Natively process English, French, and Mauritian Creole phrases. Comprehend local landmarks, university frameworks (UoM/UTM), banking rails (Juice/Blink), and local daily realities.

---

## 2. Global System State Machine

```text
[Scan QR / Deep Link]
       |
       v
[Onboarding & Archetype Selection] (Under 45 Seconds)
       |
       v
[Active Free Trial] (Days 1–7: Conversational Data Harvesting)
       |
       v
[Sunday Diagnostic Report Generation] (Irresistible Data Cliffhanger)
       |
       v
[Paywall & Encryption Lock] (Day 8: Deep-links to MCB Juice / Blink)
       |
       v
[Paid Premium Stream] (Access Unlocked + Squad Features Enabled)
```

## 3. Core Database Schema (Supabase / PostgreSQL)
Run the following SQL script directly in your Supabase SQL Editor to initialize your structured storage layer:

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Core Users Table
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT UNIQUE NOT NULL,
    first_name TEXT,
    archetype TEXT DEFAULT 'Life & Habit Tracking', -- 'Student Grind', 'Corporate / Career', etc.
    subscription_status TEXT DEFAULT 'Trial_Active', -- 'Trial_Active', 'Paid_Active', 'Locked'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Finance Logs Table
CREATE TABLE public.finance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    category TEXT NOT NULL,
    context_tags TEXT[],
    raw_source_text TEXT NOT NULL,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Habit & Focus Logs Table
CREATE TABLE public.habit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    activity_type TEXT NOT NULL,
    duration_minutes INT DEFAULT 0,
    is_success BOOLEAN DEFAULT true,
    context_note TEXT,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. To-Do Engine Table
CREATE TABLE public.todo_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    task_description TEXT NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE,
    priority TEXT DEFAULT 'Medium',
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 5. Emotional & Insights Long-Term Vault
CREATE TABLE public.insights_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    anxiety_score INT CHECK (anxiety_score BETWEEN 1 AND 5),
    core_emotional_driver TEXT,
    raw_unfiltered_vent TEXT NOT NULL,
    embedding VECTOR(1536),
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Mauri Squads Table
CREATE TABLE public.squads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    squad_code TEXT UNIQUE NOT NULL,
    squad_name TEXT NOT NULL,
    member_ids UUID[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Performance Optimization Indexes
CREATE INDEX idx_finance_logs_user_date ON public.finance_logs(user_id, logged_at DESC);
CREATE INDEX idx_habit_logs_user_date ON public.habit_logs(user_id, logged_at DESC);
CREATE INDEX idx_todo_logs_user_status ON public.todo_logs(user_id, is_completed);
```

## 4. Context Extraction Pipeline (JSON Target)
When an incoming WhatsApp webhook containing a raw text/voice message arrives, the backend server MUST run a Structured Output schema extraction via the gemini-1.5-flash model.

### The Target JSON Schema for the Parser Engine:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MauriBrainDumpExtraction",
  "type": "object",
  "properties": {
    "finance": {
      "type": "object",
      "properties": {
        "amount": { "type": "number" },
        "category": { "type": "string" },
        "context_tags": { "type": "array", "items": { "type": "string" } },
        "raw_source_text": { "type": "string" }
      },
      "required": ["amount", "category", "raw_source_text"]
    },
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "task_description": { "type": "string" },
          "due_date": { "type": "string", "format": "date-time" },
          "priority": { "type": "string", "enum": ["High", "Medium", "Low"] }
        },
        "required": ["task_description"]
      }
    },
    "habits": {
      "type": "object",
      "properties": {
        "activity_type": { "type": "string" },
        "duration_minutes": { "type": "integer" },
        "is_success": { "type": "boolean" },
        "context_note": { "type": "string" }
      },
      "required": ["activity_type", "is_success"]
    },
    "emotions": {
      "type": "object",
      "properties": {
        "anxiety_score": { "type": "integer", "minimum": 1, "maximum": 5 },
        "core_emotional_driver": { "type": "string" },
        "raw_unfiltered_vent": { "type": "string" }
      },
      "required": ["anxiety_score", "raw_unfiltered_vent"]
    }
  }
}
```

## 5. Script Core Logic Flows
### A. Context-Enriched Response Loop (The Processing Window)
1. Catch incoming WhatsApp message event hook.
2. Query the database using user_id to retrieve profile context.
3. Fetch user's historical metadata for the current context (e.g., pending tasks, current financial balance, recent emotional metrics via vector search).
4. Inject retrieved metadata into a hidden instruction system prompt.
5. Query Gemini 1.5 Flash using the structured instruction system prompt wrapper + current message text.
6. Commit extracted tracking metrics silently to respective logs tables.
7. Dispatch the natural, conversational response back to the user via WhatsApp.

### B. The Mauri Squads Accountability Loop
* **Privacy Guardrail:** Do NOT deploy a shared group chat room. Users speak exclusively within their private chat threads with Mauri.
* **The Cross-Private Nudge Loop:** Run a server cron job (e.g., every afternoon at 15:00) to fetch relative positions within localized squads.member_ids structures. If Member A logs outperforming stats while Member B registers trailing metrics, fire target private automated reminders via the system instance to Member B's thread using peer context.
* **The Sunday Showdown:** Execute an automated task script at 20:30 every Sunday. Calculate the aggregated metrics row states, structure a competitive group ranking output scoreboard, and broadcast it to each member's private chat instances simultaneously.

## 6. Financial Operating Assertions
* Target User Subscription Rate: **Rs 200 / Month**
* Calculated Overhead Margin Target: **~89.5% Net Profit**
* Fixed Architecture Stack Baseline: Render Application Base Node Server Container Tier + Supabase Production Database Storage Box Tier.
* Scalable Variables Layer: Meta Developer API Business Account Billing Tiers (Per 24-Hour Conversation Session) + Google Vertex / AI Studio API Token Processing Matrix.
