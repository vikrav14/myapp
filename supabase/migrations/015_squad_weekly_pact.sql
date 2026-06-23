ALTER TABLE public.squads
ADD COLUMN weekly_pact_key TEXT,
ADD COLUMN weekly_pact_label TEXT,
ADD COLUMN weekly_pact_set_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN weekly_pact_set_by UUID REFERENCES public.users(id);

CREATE INDEX idx_squads_weekly_pact_key ON public.squads(weekly_pact_key);
