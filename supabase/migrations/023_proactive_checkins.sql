ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS proactive_checkins_paused_until TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.proactive_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    mode TEXT NOT NULL,
    hook_summary TEXT NOT NULL,
    message_text TEXT NOT NULL,
    delivery_key TEXT NOT NULL UNIQUE,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT proactive_checkins_mode_check
        CHECK (mode IN ('care', 'useful', 'curious'))
);

CREATE INDEX IF NOT EXISTS idx_proactive_checkins_user_sent
    ON public.proactive_checkins(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_checkins_delivery_key
    ON public.proactive_checkins(delivery_key);
