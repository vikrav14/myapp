CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT UNIQUE NOT NULL,
    first_name TEXT,
    archetype TEXT DEFAULT 'Life & Habit Tracking',
    subscription_status TEXT DEFAULT 'Trial_Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.finance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    category TEXT NOT NULL,
    context_tags TEXT[],
    raw_source_text TEXT NOT NULL,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.habit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    activity_type TEXT NOT NULL,
    duration_minutes INT DEFAULT 0,
    is_success BOOLEAN DEFAULT true,
    context_note TEXT,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

CREATE TABLE public.insights_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    anxiety_score INT CHECK (anxiety_score BETWEEN 1 AND 5),
    core_emotional_driver TEXT,
    raw_unfiltered_vent TEXT NOT NULL,
    embedding VECTOR(1536),
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.squads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    squad_code TEXT UNIQUE NOT NULL,
    squad_name TEXT NOT NULL,
    member_ids UUID[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_finance_logs_user_date ON public.finance_logs(user_id, logged_at DESC);
CREATE INDEX idx_habit_logs_user_date ON public.habit_logs(user_id, logged_at DESC);
CREATE INDEX idx_todo_logs_user_status ON public.todo_logs(user_id, is_completed);
