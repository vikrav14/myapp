import { config } from "dotenv";
import { z } from "zod";

config();

const optionalSecret = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

const optionalCsv = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().optional());

const envBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GOOGLE_AI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: optionalSecret,
  WHATSAPP_PHONE_NUMBER_ID: optionalSecret,
  MCB_JUICE_PAYMENT_LINK: optionalSecret,
  BLINK_PAYMENT_LINK: optionalSecret,
  BLINK_API_KEY: optionalSecret,
  BLINK_SECRET_KEY: optionalSecret,
  BLINK_TOKEN_API_URL: z.string().url().default("https://api.blinkpayment.co.uk/api/pay/v1/tokens"),
  SUBSCRIPTION_MONTHLY_PRICE_RS: z.coerce.number().int().positive().default(200),
  DEFAULT_SUBSCRIPTION_DAYS: z.coerce.number().int().positive().default(30),
  INTERNAL_ADMIN_API_KEY: optionalSecret,
  EMBEDDING_MODEL: z.string().default("text-embedding-004"),
  EMBEDDING_OUTPUT_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  MCB_JUICE_CALLBACK_TOKEN: optionalSecret,
  BLINK_CALLBACK_TOKEN: optionalSecret,
  PAYMENT_CALLBACK_BASE_URL: optionalSecret,
  PAYMENT_RETURN_URL: optionalSecret,
  PEACH_ENTITY_ID: optionalSecret,
  PEACH_CHECKOUT_SECRET: optionalSecret,
  PEACH_CHECKOUT_URL: z.string().url().default("https://secure.peachpayments.com/checkout/initiate"),
  BLINK_PAYLINK_API_URL: z.string().url().default("https://api.blinkpayment.co.uk/api/paylink/v1/paylinks"),
  PEACH_WEBHOOK_SECRET: optionalSecret,
  PEACH_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  OUTBOUND_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OUTBOUND_RETRY_BASE_DELAY_SECONDS: z.coerce.number().int().positive().default(60),
  OUTBOUND_RETRY_CRON: z.string().default("*/5 * * * *"),
  TRUST_PROXY: z.union([z.boolean(), z.string(), z.number()]).optional(),
  ENABLE_SECURITY_HEADERS: envBoolean.default(true),
  ADMIN_IP_ALLOWLIST: optionalCsv,
  PAYMENT_WEBHOOK_IP_ALLOWLIST: optionalCsv,
  WHATSAPP_WEBHOOK_IP_ALLOWLIST: optionalCsv,
  METRICS_IP_ALLOWLIST: optionalCsv,
  ALERT_OUTBOUND_PENDING_THRESHOLD: z.coerce.number().int().nonnegative().default(25),
  ALERT_OUTBOUND_FAILED_THRESHOLD: z.coerce.number().int().nonnegative().default(10),
  ALERT_OPEN_DEAD_LETTER_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
  ALERT_SECURITY_WARNINGS_THRESHOLD: z.coerce.number().int().nonnegative().default(1),
  ALERT_AUDIT_ERRORS_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
  ALERT_INBOUND_DUPLICATE_DELIVERIES_THRESHOLD: z.coerce.number().int().nonnegative().default(10),
  ALERT_EVALUATION_CRON: z.string().default("*/5 * * * *"),
  ALERT_WEBHOOK_URL: z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }

    return value;
  }, z.string().url().optional()),
  ALERT_WEBHOOK_NOTIFY_ON_RESOLVE: envBoolean.default(false),
  MORNING_BRIEF_ENABLED: envBoolean.default(true),
  MORNING_BRIEF_TIMEZONE: z.string().default("Indian/Mauritius"),
  MORNING_BRIEF_SCRAPE_CRON: z.string().default("30 4 * * *"),
  MORNING_BRIEF_CURATE_CRON: z.string().default("0 5 * * *"),
  MORNING_BRIEF_DELIVER_CRON: z.string().default("0 7 * * *"),
  MORNING_BRIEF_RSS_FEEDS: optionalCsv,
  GOOGLE_MAPS_API_KEY: optionalSecret,
  QUANTUM_PICK_ENABLED: envBoolean.default(true),
  ANU_QUANTUM_API_KEY: optionalSecret,
  ANU_QUANTUM_API_URL: z.string().url().default("https://api.quantumnumbers.anu.edu.au"),
  QUANTUM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  TRIAL_ENGAGEMENT_ENABLED: envBoolean.default(true),
  TRIAL_ENGAGEMENT_CRON: z.string().default("0 10 * * *"),
  REMINDERS_ENABLED: envBoolean.default(true),
  REMINDER_DELIVERY_CRON: z.string().default("* * * * *"),
  CALENDAR_SYNC_ENABLED: envBoolean.default(true),
  CALENDAR_SYNC_CRON: z.string().default("*/15 * * * *"),
  CALENDAR_DELIVERY_CRON: z.string().default("*/5 * * * *"),
  CALENDAR_TODO_LOOKAHEAD_MINUTES: z.coerce.number().int().positive().default(30),
  MEMORY_RESURFACING_ENABLED: envBoolean.default(true),
  MEMORY_RESURFACING_CRON: z.string().default("0 11 * * *"),
  RECEIPT_SCAN_ENABLED: envBoolean.default(true),
  PAYDAY_RUNWAY_ENABLED: envBoolean.default(true),
  LOCAL_ALERTS_ENABLED: envBoolean.default(true),
  LOCAL_ALERTS_CRON: z.string().default("*/30 21-23,0-7 * * *"),
  LOCAL_ALERT_RSS_FEEDS: optionalCsv,
  WHATSAPP_REACTIONS_ENABLED: envBoolean.default(true),
  WHATSAPP_MARK_READ_ENABLED: envBoolean.default(true),
  WHATSAPP_INTERACTIVE_ENABLED: envBoolean.default(true),
  PROACTIVE_DAILY_BUDGET: z.coerce.number().int().positive().default(2),
  WHATSAPP_TYPING_INDICATOR_ENABLED: envBoolean.default(true),
  USER_MIND_SNAPSHOTS_ENABLED: envBoolean.default(true),
  USER_MIND_REFLECT_CRON: z.string().default("0 2 * * *"),
  USER_MIND_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  USER_MIND_ACTIVITY_LOOKBACK_DAYS: z.coerce.number().int().positive().default(14),
  USER_MIND_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  OPEN_LOOP_FOLLOWUPS_ENABLED: envBoolean.default(true),
  OPEN_LOOP_FOLLOWUP_CRON: z.string().default("0 10 * * *"),
  OPEN_LOOP_FOLLOWUP_HOUR: z.coerce.number().int().min(0).max(23).default(10),
  OPEN_LOOP_FOLLOWUP_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  PROACTIVE_CHECKINS_ENABLED: envBoolean.default(true),
  PROACTIVE_CHECKIN_CRON: z.string().default("0 16 * * *"),
  PROACTIVE_CHECKIN_HOUR: z.coerce.number().int().min(0).max(23).default(16),
  PROACTIVE_CHECKIN_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  RELATIONSHIP_ENGAGEMENT_ENABLED: envBoolean.default(true),
  RELATIONSHIP_EVENING_CRON: z.string().default("0 19 * * *"),
  WHATSAPP_RICH_MEDIA_ENABLED: envBoolean.default(true),
  WHATSAPP_STICKERS_ENABLED: envBoolean.default(true),
  MAURI_PUBLIC_BASE_URL: optionalSecret,
  MAURI_WELCOME_IMAGE_URL: optionalSecret,
  MAURI_LOCKED_IN_STICKER_URL: optionalSecret,
  MESSAGE_ROUTER_MODE: z.enum(["off", "shadow", "commit"]).default("off")
});

export const env = envSchema.parse(process.env);
