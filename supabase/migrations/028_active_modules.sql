ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS active_modules TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.users.active_modules IS 'Capability modules: career, habits, founder, student';

UPDATE public.users
SET active_modules = CASE
  WHEN archetype IN ('Corporate / Career') THEN ARRAY['career']::TEXT[]
  WHEN archetype IN ('Life & Habit Tracking') THEN ARRAY['habits']::TEXT[]
  WHEN archetype IN ('Student Grind') THEN ARRAY['student']::TEXT[]
  WHEN archetype IN ('Entrepreneur Mode') THEN ARRAY['founder']::TEXT[]
  WHEN archetype IN ('Custom', 'My Own Mix') THEN ARRAY['career']::TEXT[]
  ELSE '{}'::TEXT[]
END
WHERE active_modules = '{}'::TEXT[];
