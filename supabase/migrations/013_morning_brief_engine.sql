ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS topic_preferences TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS morning_digest_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE public.daily_brief_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_date DATE NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_scrape',
    scrape_payload JSONB,
    traffic_snapshot JSONB,
    weather_snapshot JSONB,
    curated_payload JSONB,
    error_message TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE,
    curated_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.daily_brief_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES public.daily_brief_runs(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    delivery_status TEXT NOT NULL,
    message_text TEXT,
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_daily_brief_runs_status ON public.daily_brief_runs(status, brief_date DESC);
CREATE INDEX idx_daily_brief_deliveries_run ON public.daily_brief_deliveries(run_id, created_at DESC);
CREATE INDEX idx_users_topic_preferences ON public.users USING GIN (topic_preferences);
