ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS open_loop_followups_enabled BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS public.open_loop_follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    mind_snapshot_id UUID REFERENCES public.user_mind_snapshots(id) ON DELETE SET NULL,
    loop_text TEXT NOT NULL,
    loop_fingerprint TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user_mind',
    status TEXT NOT NULL DEFAULT 'pending',
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    message_text TEXT,
    delivery_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT open_loop_follow_ups_status_check
        CHECK (status IN ('pending', 'sent', 'cancelled', 'skipped')),
    CONSTRAINT open_loop_follow_ups_source_check
        CHECK (source IN ('user_mind', 'user_requested'))
);

CREATE INDEX IF NOT EXISTS idx_open_loop_follow_ups_due
    ON public.open_loop_follow_ups(status, scheduled_for)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_open_loop_follow_ups_user_fingerprint
    ON public.open_loop_follow_ups(user_id, loop_fingerprint, created_at DESC);
