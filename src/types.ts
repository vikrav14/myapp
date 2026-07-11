import type { UserMindSnapshotPayload } from "./schemas/user-mind.js";

export type SubscriptionStatus = "Trial_Active" | "Paid_Active" | "Locked";
export type OnboardingState =
  | "awaiting_know_you"
  | "awaiting_express_start"
  | "awaiting_archetype"
  | "awaiting_brief_focus"
  | "awaiting_modules"
  | "awaiting_topics"
  | "active";
export type UserMindCategory =
  | "identity"
  | "location"
  | "life_context"
  | "interests"
  | "goals"
  | "stressors"
  | "preferences"
  | "boundaries"
  | "relationships"
  | "user_stated";
export type UserMindSource = "onboarding" | "user_stated" | "inferred" | "feedback";
export type MorningBriefTopicKey = "Traffic" | "Tech" | "Money" | "LocalBuzz" | "Entertainment";
export type MorningBriefDensity = "pulse" | "full";
export type PaymentProvider = "MCB_JUICE" | "BLINK" | "MANUAL";
export type MemoryType = "user_message" | "assistant_reply" | "emotion_signal" | "weekly_report";
export type AuditSeverity = "info" | "warning" | "error";
export type MauriArchetype =
  | "Life & Habit Tracking"
  | "Student Grind"
  | "Corporate / Career"
  | "Entrepreneur Mode"
  | "Custom";

/** Stored on users who pick the free-form lane at onboarding. */
export const CUSTOM_LANE_ARCHETYPE = "Custom" as const satisfies MauriArchetype;

/** Legacy value — still recognised when loading existing users. */
export const LEGACY_CUSTOM_LANE_ARCHETYPE = "My Own Mix";

export function isCustomLaneArchetype(archetype: string): boolean {
  return archetype === CUSTOM_LANE_ARCHETYPE || archetype === LEGACY_CUSTOM_LANE_ARCHETYPE;
}

export function canonicalArchetypeKey(archetype: string): string {
  return isCustomLaneArchetype(archetype) ? CUSTOM_LANE_ARCHETYPE : archetype;
}

export type MauriModuleKey = "career" | "habits" | "founder" | "student";

export type HelpFocusKey =
  | "productivity"
  | "personal_finance"
  | "business"
  | "self_help"
  | "critical_thinking"
  | "relationship"
  | "human_behavior"
  | "philosophy"
  | "discipline"
  | "communication"
  | "health"
  | "career"
  | "parenting"
  | "psychology"
  | "art";

export type ProactivePacePreset = "silent" | "bookends" | "steady" | "engaged" | "coaching";

export type DensityProfile = "micro" | "pulse" | "depth";

export interface NotificationConfig {
  proactive_preset: ProactivePacePreset;
  density_profile: DensityProfile;
  proactive_max_per_day: number;
  proactive_min_interval_minutes: number;
  proactive_max_per_week: number;
  configured_at?: string | undefined;
}

export interface MauriUser {
  id: string;
  phone_number: string;
  first_name: string | null;
  archetype: MauriArchetype | string;
  brief_focus: string | null;
  active_modules: MauriModuleKey[];
  help_focus_primary: HelpFocusKey | null;
  help_focus_secondary: HelpFocusKey | null;
  onboarding_state: OnboardingState;
  subscription_status: SubscriptionStatus;
  onboarding_completed_at: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  locked_at: string | null;
  subscription_started_at: string | null;
  subscription_ends_at: string | null;
  last_payment_at: string | null;
  topic_preferences: MorningBriefTopicKey[];
  morning_digest_enabled: boolean;
  morning_brief_density: MorningBriefDensity;
  calendar_sync_enabled: boolean;
  memory_resurfacing_enabled: boolean;
  local_alerts_enabled: boolean;
  school_alerts_enabled: boolean;
  payday_day_of_month: number | null;
  monthly_income_rs: number | null;
  weekly_focus_habit: string | null;
  weekly_focus_set_at: string | null;
  open_loop_followups_enabled: boolean;
  proactive_checkins_paused_until: string | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start_hour: number;
  quiet_hours_end_hour: number;
  notification_config: NotificationConfig | null;
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

export interface PaymentCheckoutSessionRecord {
  id: string;
  user_id: string;
  provider: PaymentProvider | string;
  status: string;
  user_reference: string;
  provider_reference: string;
  amount: number;
  currency: string;
  duration_days: number;
  provider_payload: Record<string, unknown>;
  provider_endpoint: string | null;
  checkout_url: string | null;
  provider_session_id: string | null;
  provider_response: Record<string, unknown> | null;
  activated_payment_event_id: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyDailySeries {
  labels: string[];
  spend_rs: Array<number | null>;
  habit_wins: Array<number | null>;
  mood_avg: Array<number | null>;
}

export interface WeeklyReportMemorySnapshot {
  active_focus: string | null;
  open_loops: string[];
  strategy_track: string | null;
}

export interface WeeklyWeekOverWeek {
  prior_week_start: string | null;
  spend_delta_pct: number | null;
  habit_wins_delta: number | null;
  momentum_delta: number | null;
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
  daily?: WeeklyDailySeries;
  week_over_week?: WeeklyWeekOverWeek;
  memory?: WeeklyReportMemorySnapshot;
}

export type WeeklyFeedbackReason =
  | "early_calibration"
  | "low_signal"
  | "momentum_drop"
  | "quiet_power_user"
  | "periodic_pulse";

export type WeeklyFeedbackVariant = "rating" | "context" | "open";

export interface WeeklyFeedbackPromptContext {
  include: boolean;
  reason: WeeklyFeedbackReason | null;
  variant: WeeklyFeedbackVariant;
  skip_reason:
    | "trial_cliffhanger"
    | "recent_feedback"
    | "ghost_week"
    | "no_trigger"
    | null;
  prior_report_count: number;
  weeks_since_feedback: number | null;
  message_count_this_week: number;
  momentum_delta: number | null;
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
  feedback_prompt_json?: WeeklyFeedbackPromptContext | null;
  feedback_responded_at?: string | null;
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

export interface AuditEventRecord {
  id: string;
  request_id: string | null;
  event_type: string;
  severity: AuditSeverity | string;
  actor_type: string | null;
  actor_id: string | null;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface OutboundMessageRecord {
  id: string;
  provider: string;
  channel: string;
  user_id: string | null;
  phone_number: string;
  body: string;
  status: string;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeadLetterEventRecord {
  id: string;
  source_table: string;
  source_id: string;
  category: string;
  status: string;
  user_id: string | null;
  request_id: string | null;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationalAlertStateRecord {
  id: string;
  alert_key: string;
  severity: AuditSeverity | string;
  status: string;
  message: string;
  current_value: number | null;
  threshold_value: number | null;
  metadata: Record<string, unknown> | null;
  last_evaluated_at: string;
  triggered_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricsSnapshot {
  generated_at: string;
  uptime_seconds: number;
  process_resident_memory_bytes: number;
  users_total: number;
  users_trial_active: number;
  users_paid_active: number;
  users_locked: number;
  users_awaiting_archetype: number;
  outbound_pending: number;
  outbound_failed: number;
  outbound_permanent_failed: number;
  dead_letters_open: number;
  alerts_open: number;
  payments_24h: number;
  reports_24h: number;
  voice_notes_24h: number;
  audit_errors_24h: number;
  inbound_duplicate_deliveries_24h: number;
}

export type DailyBriefRunStatus =
  | "pending_scrape"
  | "scraped"
  | "curating"
  | "curated"
  | "delivering"
  | "delivered"
  | "failed";

export interface DailyBriefRunRecord {
  id: string;
  brief_date: string;
  status: DailyBriefRunStatus | string;
  scrape_payload: Record<string, unknown> | null;
  traffic_snapshot: Record<string, unknown> | null;
  weather_snapshot: Record<string, unknown> | null;
  curated_payload: Record<string, unknown> | null;
  error_message: string | null;
  scraped_at: string | null;
  curated_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyBriefDeliveryRecord {
  id: string;
  run_id: string;
  user_id: string;
  delivery_status: string;
  message_text: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface CuratedMorningStory {
  topic: MorningBriefTopicKey | string;
  headline: string;
  summary: string;
  source: string;
  url?: string | undefined;
}

export interface CuratedMorningBrief {
  brief_date: string;
  weather_line: string;
  traffic_line: string;
  stories: CuratedMorningStory[];
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
  userMindFacts: UserMindFact[];
  userMindPrompt: string;
  userMindSnapshot: UserMindSnapshotPayload | null;
  userMindSnapshotPrompt: string | null;
  userMindSnapshotGeneratedAt: string | null;
}

export interface UserMindFact {
  id: string;
  user_id: string;
  category: UserMindCategory | string;
  fact_key: string;
  fact_value: string;
  source: UserMindSource | string;
  confidence: number;
  user_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserMindRecord {
  id: string;
  user_id: string;
  snapshot: UserMindSnapshotPayload;
  source_window_start: string;
  source_window_end: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppReplyButton {
  id: string;
  title: string;
}

export interface WhatsAppListRow {
  id: string;
  title: string;
  description?: string | undefined;
}

export interface WhatsAppListSection {
  title?: string | undefined;
  rows: WhatsAppListRow[];
}

export interface WhatsAppCtaUrlButton {
  displayText: string;
  url: string;
}

export interface WhatsAppInteractiveOutbound {
  body: string;
  header?: string | undefined;
  footer?: string | undefined;
  buttons?: WhatsAppReplyButton[] | undefined;
  ctaUrl?: WhatsAppCtaUrlButton | undefined;
  listButtonLabel?: string | undefined;
  sections?: WhatsAppListSection[] | undefined;
}

export interface WhatsAppImageOutbound {
  url: string;
  caption?: string | undefined;
}

export interface MauriReplyPayload {
  text?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  image?: WhatsAppImageOutbound | undefined;
}

export interface InboundMessage {
  from: string;
  kind: "text" | "audio" | "image" | "interactive" | "reaction";
  text?: string | undefined;
  messageId?: string | undefined;
  profileName?: string | undefined;
  interactiveReplyId?: string | undefined;
  reaction?: {
    emoji: string;
    targetMessageId: string;
  };
  audio?: {
    mediaId?: string | undefined;
    mimeType?: string | undefined;
    url?: string | undefined;
  };
  image?: {
    mediaId?: string | undefined;
    mimeType?: string | undefined;
    url?: string | undefined;
    caption?: string | undefined;
  };
  rawPayload: unknown;
}
