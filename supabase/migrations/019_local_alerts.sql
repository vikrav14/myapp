ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS local_alerts_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS school_alerts_enabled BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS public.local_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT NOT NULL UNIQUE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'high',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    advice_text TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    raw_payload JSONB,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT local_alerts_type_check
        CHECK (alert_type IN ('school_closure', 'heavy_rain', 'cyclone', 'flood', 'traffic_disruption', 'general_advisory')),
    CONSTRAINT local_alerts_severity_check
        CHECK (severity IN ('high', 'medium')),
    CONSTRAINT local_alerts_status_check
        CHECK (status IN ('active', 'expired'))
);

CREATE TABLE IF NOT EXISTS public.local_alert_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES public.local_alerts(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    delivered_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (alert_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_local_alerts_created
    ON public.local_alerts(created_at DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_local_alert_deliveries_user
    ON public.local_alert_deliveries(user_id, delivered_at DESC);
