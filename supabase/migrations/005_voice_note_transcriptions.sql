CREATE TABLE public.voice_note_transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    provider TEXT NOT NULL DEFAULT 'whatsapp',
    source_message_id TEXT,
    media_id TEXT,
    mime_type TEXT,
    transcript_text TEXT NOT NULL,
    raw_payload JSONB,
    transcribed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_voice_note_transcriptions_user_date
ON public.voice_note_transcriptions(user_id, transcribed_at DESC);
