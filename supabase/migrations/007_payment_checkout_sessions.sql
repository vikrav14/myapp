CREATE TABLE public.payment_checkout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared',
    user_reference TEXT NOT NULL,
    provider_reference TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'MUR',
    duration_days INT NOT NULL DEFAULT 30,
    provider_payload JSONB NOT NULL,
    provider_endpoint TEXT,
    checkout_url TEXT,
    provider_session_id TEXT,
    provider_response JSONB,
    activated_payment_event_id UUID REFERENCES public.payment_events(id) ON DELETE SET NULL,
    activated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(provider, provider_reference)
);

CREATE INDEX idx_payment_checkout_sessions_user_date
ON public.payment_checkout_sessions(user_id, created_at DESC);

CREATE INDEX idx_payment_checkout_sessions_status
ON public.payment_checkout_sessions(status, provider);
