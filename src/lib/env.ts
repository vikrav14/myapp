import { config } from "dotenv";
import { z } from "zod";

config();

const optionalSecret = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

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
  EMBEDDING_OUTPUT_DIMENSIONS: z.coerce.number().int().positive().default(1536)
});

export const env = envSchema.parse(process.env);
