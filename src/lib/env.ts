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
  GEMINI_MODEL: z.string().default("gemini-1.5-flash"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: optionalSecret,
  WHATSAPP_PHONE_NUMBER_ID: optionalSecret,
  MCB_JUICE_PAYMENT_LINK: optionalSecret,
  BLINK_PAYMENT_LINK: optionalSecret,
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
  ALERT_WEBHOOK_NOTIFY_ON_RESOLVE: envBoolean.default(false)
});

export const env = envSchema.parse(process.env);
