export type SubscriptionStatus = "Trial_Active" | "Paid_Active" | "Locked";

export interface MauriUser {
  id: string;
  phone_number: string;
  first_name: string | null;
  archetype: string;
  subscription_status: SubscriptionStatus;
  created_at: string;
  updated_at: string;
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
}

export interface InboundMessage {
  from: string;
  text: string;
  profileName?: string | undefined;
  rawPayload: unknown;
}
