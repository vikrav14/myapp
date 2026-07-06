ALTER TABLE public.users ADD COLUMN IF NOT EXISTS brief_focus TEXT;

COMMENT ON COLUMN public.users.brief_focus IS 'User-defined 7am brief focus for Your own mix lane';
