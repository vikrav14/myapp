CREATE TABLE IF NOT EXISTS public.scheduled_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    label TEXT NOT NULL,
    next_fire_at TIMESTAMP WITH TIME ZONE NOT NULL,
    repeat_kind TEXT NOT NULL DEFAULT 'once',
    repeat_hour SMALLINT,
    repeat_minute SMALLINT,
    repeat_weekdays SMALLINT[],
    timezone TEXT NOT NULL DEFAULT 'Indian/Mauritius',
    status TEXT NOT NULL DEFAULT 'active',
    last_fired_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT scheduled_reminders_repeat_kind_check
        CHECK (repeat_kind IN ('once', 'daily', 'weekdays', 'weekly'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_due
    ON public.scheduled_reminders(status, next_fire_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_user
    ON public.scheduled_reminders(user_id, status, created_at DESC);
