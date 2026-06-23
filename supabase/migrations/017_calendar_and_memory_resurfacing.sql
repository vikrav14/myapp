ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS calendar_sync_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS memory_resurfacing_enabled BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS public.calendar_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    ical_url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Calendar',
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_error TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT calendar_connections_status_check CHECK (status IN ('active', 'disconnected')),
    UNIQUE (user_id, ical_url)
);

CREATE TABLE IF NOT EXISTS public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES public.calendar_connections(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE,
    source TEXT NOT NULL DEFAULT 'manual',
    external_uid TEXT,
    location TEXT,
    reminder_lead_minutes SMALLINT NOT NULL DEFAULT 30,
    pre_reminder_sent_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT calendar_events_source_check CHECK (source IN ('manual', 'ical', 'todo')),
    CONSTRAINT calendar_events_status_check CHECK (status IN ('active', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_external_uid
    ON public.calendar_events(user_id, external_uid)
    WHERE external_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_upcoming
    ON public.calendar_events(user_id, starts_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_calendar_events_pre_reminder
    ON public.calendar_events(status, starts_at, pre_reminder_sent_at)
    WHERE status = 'active' AND pre_reminder_sent_at IS NULL;

CREATE TABLE IF NOT EXISTS public.memory_resurfacing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    memory_source TEXT NOT NULL,
    memory_id UUID NOT NULL,
    delivery_key TEXT NOT NULL,
    message_text TEXT NOT NULL,
    surfaced_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT memory_resurfacing_log_source_check
        CHECK (memory_source IN ('conversation_memory', 'insight_memory', 'todo')),
    UNIQUE (user_id, delivery_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_resurfacing_log_user_date
    ON public.memory_resurfacing_log(user_id, surfaced_at DESC);
