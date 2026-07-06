ALTER TABLE public.open_loop_follow_ups
DROP CONSTRAINT IF EXISTS open_loop_follow_ups_source_check;

ALTER TABLE public.open_loop_follow_ups
ADD CONSTRAINT open_loop_follow_ups_source_check
    CHECK (source IN ('user_mind', 'user_requested', 'onboarding'));
