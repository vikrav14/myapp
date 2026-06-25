ALTER TABLE public.squads
ADD COLUMN weekly_pact_weights JSONB;

COMMENT ON COLUMN public.squads.weekly_pact_weights IS
  'Custom scoring weights when weekly_pact_key = custom: { habitSuccess, studyHabitBonus, todoComplete, financeLog }';
