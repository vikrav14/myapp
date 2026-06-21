CREATE TABLE public.outbound_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'whatsapp',
    channel TEXT NOT NULL DEFAULT 'text',
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    phone_number TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    request_id TEXT,
    metadata JSONB,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_outbound_messages_status_retry
ON public.outbound_messages(status, next_attempt_at ASC);

CREATE INDEX idx_outbound_messages_user_date
ON public.outbound_messages(user_id, created_at DESC);
