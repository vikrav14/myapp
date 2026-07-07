ALTER TABLE public.users ADD COLUMN IF NOT EXISTS help_focus_primary TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS help_focus_secondary TEXT;

COMMENT ON COLUMN public.users.help_focus_primary IS 'Primary advice domain: productivity, personal_finance, business, etc.';
COMMENT ON COLUMN public.users.help_focus_secondary IS 'Optional secondary advice domain';
