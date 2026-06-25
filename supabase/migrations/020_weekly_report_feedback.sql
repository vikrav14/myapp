ALTER TABLE public.weekly_reports
ADD COLUMN IF NOT EXISTS feedback_prompt_json JSONB,
ADD COLUMN IF NOT EXISTS feedback_responded_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.service_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    weekly_report_id UUID REFERENCES public.weekly_reports(id) ON DELETE SET NULL,
    rating SMALLINT,
    feedback_text TEXT,
    prompt_reason TEXT,
    source TEXT NOT NULL DEFAULT 'sunday_report',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT service_feedback_rating_check
        CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);

CREATE INDEX IF NOT EXISTS idx_service_feedback_user_created
    ON public.service_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_feedback_pending
    ON public.weekly_reports(user_id, sent_at DESC)
    WHERE feedback_responded_at IS NULL;
