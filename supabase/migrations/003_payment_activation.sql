ALTER TABLE public.users
ADD COLUMN subscription_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN subscription_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN last_payment_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'MUR',
    transaction_reference TEXT NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(provider, transaction_reference)
);

CREATE INDEX idx_payment_events_user_date ON public.payment_events(user_id, paid_at DESC);
CREATE INDEX idx_users_subscription_end ON public.users(subscription_ends_at);
