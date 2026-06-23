ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS weekly_focus_habit TEXT,
ADD COLUMN IF NOT EXISTS weekly_focus_set_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.engagement_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    delivery_key TEXT NOT NULL,
    delivered_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, delivery_key)
);

CREATE INDEX IF NOT EXISTS idx_engagement_deliveries_user_key
    ON public.engagement_deliveries(user_id, delivery_key);
