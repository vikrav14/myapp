ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS notification_config JSONB;

COMMENT ON COLUMN public.users.notification_config IS
  'User-owned proactive pacing: preset, density, daily caps, configured_at.';
