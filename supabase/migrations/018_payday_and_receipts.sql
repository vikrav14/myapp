ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS payday_day_of_month SMALLINT,
ADD COLUMN IF NOT EXISTS monthly_income_rs NUMERIC(10, 2);

ALTER TABLE public.users
DROP CONSTRAINT IF EXISTS users_payday_day_of_month_check;

ALTER TABLE public.users
ADD CONSTRAINT users_payday_day_of_month_check
    CHECK (payday_day_of_month IS NULL OR (payday_day_of_month >= 1 AND payday_day_of_month <= 31));

CREATE TABLE IF NOT EXISTS public.receipt_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    source_message_id TEXT,
    media_id TEXT,
    merchant TEXT,
    amount NUMERIC(10, 2) NOT NULL,
    category TEXT NOT NULL,
    items_summary TEXT,
    finance_log_id UUID REFERENCES public.finance_logs(id) ON DELETE SET NULL,
    raw_extraction JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipt_scans_user_date
    ON public.receipt_scans(user_id, created_at DESC);
