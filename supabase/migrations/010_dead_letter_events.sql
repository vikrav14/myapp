CREATE TABLE public.dead_letter_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    request_id TEXT,
    last_error TEXT,
    payload JSONB,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(source_table, source_id)
);

CREATE INDEX idx_dead_letter_events_status_date
ON public.dead_letter_events(status, created_at DESC);

CREATE INDEX idx_dead_letter_events_user_date
ON public.dead_letter_events(user_id, created_at DESC);
