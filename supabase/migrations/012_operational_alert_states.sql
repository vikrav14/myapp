CREATE TABLE public.operational_alert_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_key TEXT UNIQUE NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'closed',
    message TEXT NOT NULL,
    current_value NUMERIC,
    threshold_value NUMERIC,
    metadata JSONB,
    last_evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_operational_alert_states_status
ON public.operational_alert_states(status, severity, updated_at DESC);
