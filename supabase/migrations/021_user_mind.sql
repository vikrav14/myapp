CREATE TABLE public.user_mind_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    category TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user_stated',
    confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    user_visible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, category, fact_key)
);

CREATE INDEX idx_user_mind_facts_user_category
    ON public.user_mind_facts(user_id, category);

CREATE INDEX idx_user_mind_facts_user_updated
    ON public.user_mind_facts(user_id, updated_at DESC);
