export type SubscriptionStatus = "Trial_Active" | "Paid_Active" | "Locked";
export type OnboardingState = "awaiting_archetype" | "active";
export type PaymentProvider = "MCB_JUICE" | "BLINK" | "MANUAL";
export type MemoryType = "user_message" | "assistant_reply" | "emotion_signal" | "weekly_report";
export type MauriArchetype =
  | "Life & Habit Tracking"
  | "Student Grind"
  | "Corporate / Career"
  | "Entrepreneur Mode";

export interface MauriUser {
  id: string;
  phone_number: string;
  first_name: string | null;
  archetype: MauriArchetype | string;
  onboarding_state: OnboardingState;
  subscription_status: SubscriptionStatus;
  onboarding_completed_at: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  locked_at: string | null;
  subscription_started_at: string | null;
  subscription_ends_at: string | null;
  last_payment_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentEvent {
  id: string;
  user_id: string;
  provider: PaymentProvider | string;
  status: string;
  amount: number;
  currency: string;
  transaction_reference: string;
  paid_at: string;
  raw_payload: unknown;
  created_at: string;
}

export interface WeeklyDiagnosticSummary {
  window: {
    week_start: string;
    week_end: string;
  };
  finance: {
    total_spent: number;
    entry_count: number;
    top_category: string | null;
  };
  habits: {
    total_logs: number;
    successful_logs: number;
    success_rate: number;
    total_minutes: number;
    top_activity: string | null;
  };
  todos: {
    created_count: number;
    completed_count: number;
    open_count: number;
  };
  emotions: {
    average_anxiety: number | null;
    latest_anxiety: number | null;
    dominant_driver: string | null;
  };
  momentum_score: number;
  trial_cliffhanger: boolean;
}

export interface WeeklyReportRecord {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  report_text: string;
  summary_json: WeeklyDiagnosticSummary;
  delivery_status: string;
  sent_at: string | null;
  created_at: string;
}

export interface VoiceNoteTranscriptionRecord {
  id: string;
  user_id: string;
  provider: string;
  source_message_id: string | null;
  media_id: string | null;
  mime_type: string | null;
  transcript_text: string;
  raw_payload: unknown;
  transcribed_at: string;
  created_at: string;
}

export interface SemanticMemoryMatch {
  source: "conversation_memory" | "emotion_memory";
  text: string;
  similarity: number;
  created_at: string;
  memory_type?: MemoryType | string | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  anxiety_score?: number | null | undefined;
  core_emotional_driver?: string | null | undefined;
}

export interface FinanceExtraction {
  amount: number;
  category: string;
  context_tags?: string[] | undefined;
  raw_source_text: string;
}

export interface TodoExtraction {
  task_description: string;
  due_date?: string | undefined;
  priority?: "High" | "Medium" | "Low" | undefined;
}

export interface HabitExtraction {
  activity_type: string;
  duration_minutes?: number | undefined;
  is_success: boolean;
  context_note?: string | undefined;
}

export interface EmotionExtraction {
  anxiety_score: number;
  core_emotional_driver?: string | undefined;
  raw_unfiltered_vent: string;
}

export interface MauriBrainDumpExtraction {
  finance?: FinanceExtraction | undefined;
  todos?: TodoExtraction[] | undefined;
  habits?: HabitExtraction | undefined;
  emotions?: EmotionExtraction | undefined;
}

export interface UserContextSnapshot {
  pendingTodos: Array<{
    id: string;
    task_description: string;
    priority: string;
    due_date: string | null;
  }>;
  recentFinance: Array<{
    amount: number;
    category: string;
    logged_at: string;
  }>;
  recentHabits: Array<{
    activity_type: string;
    is_success: boolean;
    duration_minutes: number;
    logged_at: string;
  }>;
  recentEmotions: Array<{
    anxiety_score: number | null;
    core_emotional_driver: string | null;
    raw_unfiltered_vent: string;
    logged_at: string;
  }>;
  semanticMemories: SemanticMemoryMatch[];
}

export interface InboundMessage {
  from: string;
  kind: "text" | "audio";
  text?: string | undefined;
  messageId?: string | undefined;
  profileName?: string | undefined;
  audio?: {
    mediaId?: string | undefined;
    mimeType?: string | undefined;
    url?: string | undefined;
  };
  rawPayload: unknown;
}
