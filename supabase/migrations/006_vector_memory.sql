CREATE TABLE public.conversation_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    memory_type TEXT NOT NULL,
    source_message_id TEXT,
    content_text TEXT NOT NULL,
    metadata JSONB,
    embedding VECTOR(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_conversation_memories_user_date
ON public.conversation_memories(user_id, created_at DESC);

CREATE INDEX idx_conversation_memories_embedding
ON public.conversation_memories
USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_insights_vault_embedding
ON public.insights_vault
USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_conversation_memories(
    match_user_id UUID,
    query_embedding VECTOR(1536),
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    content_text TEXT,
    memory_type TEXT,
    metadata JSONB,
    similarity DOUBLE PRECISION,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        conversation_memories.id,
        conversation_memories.content_text,
        conversation_memories.memory_type,
        conversation_memories.metadata,
        1 - (conversation_memories.embedding <=> query_embedding) AS similarity,
        conversation_memories.created_at
    FROM public.conversation_memories
    WHERE conversation_memories.user_id = match_user_id
      AND conversation_memories.embedding IS NOT NULL
    ORDER BY conversation_memories.embedding <=> query_embedding
    LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_insight_memories(
    match_user_id UUID,
    query_embedding VECTOR(1536),
    match_count INT DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    raw_unfiltered_vent TEXT,
    core_emotional_driver TEXT,
    anxiety_score INT,
    similarity DOUBLE PRECISION,
    logged_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        insights_vault.id,
        insights_vault.raw_unfiltered_vent,
        insights_vault.core_emotional_driver,
        insights_vault.anxiety_score,
        1 - (insights_vault.embedding <=> query_embedding) AS similarity,
        insights_vault.logged_at
    FROM public.insights_vault
    WHERE insights_vault.user_id = match_user_id
      AND insights_vault.embedding IS NOT NULL
    ORDER BY insights_vault.embedding <=> query_embedding
    LIMIT match_count;
$$;
