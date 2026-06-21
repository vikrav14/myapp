ALTER TABLE public.users
ADD COLUMN onboarding_state TEXT DEFAULT 'active' NOT NULL,
ADD COLUMN onboarding_completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN trial_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN trial_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN locked_at TIMESTAMP WITH TIME ZONE;

UPDATE public.users
SET onboarding_state = 'active'
WHERE onboarding_state IS NULL;

CREATE INDEX idx_users_subscription_status ON public.users(subscription_status);
CREATE INDEX idx_users_trial_end ON public.users(trial_ends_at);
