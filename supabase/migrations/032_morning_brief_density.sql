ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS morning_brief_density TEXT NOT NULL DEFAULT 'pulse'
CHECK (morning_brief_density IN ('pulse', 'full'));
