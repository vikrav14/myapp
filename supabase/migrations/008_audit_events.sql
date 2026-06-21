CREATE TABLE public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    actor_type TEXT,
    actor_id TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    entity_type TEXT,
    entity_id TEXT,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_audit_events_created_at ON public.audit_events(created_at DESC);
CREATE INDEX idx_audit_events_user_event ON public.audit_events(user_id, event_type, created_at DESC);
CREATE INDEX idx_audit_events_request_id ON public.audit_events(request_id);
