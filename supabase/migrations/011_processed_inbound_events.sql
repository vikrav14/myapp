CREATE TABLE public.processed_inbound_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_kind TEXT,
    status TEXT NOT NULL DEFAULT 'processed',
    duplicate_count INT NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(provider, event_id)
);

CREATE INDEX idx_processed_inbound_events_provider_date
ON public.processed_inbound_events(provider, created_at DESC);
