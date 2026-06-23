import { z } from "zod";

export const receiptExtractionJsonSchema = {
  type: "object",
  properties: {
    amount: { type: "number" },
    merchant: { type: "string" },
    category: { type: "string" },
    items_summary: { type: "string" },
    currency: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["amount", "merchant", "category", "items_summary", "confidence"]
} as const;

export const receiptExtractionSchema = z.object({
  amount: z.number().positive(),
  merchant: z.string().min(1),
  category: z.string().min(1),
  items_summary: z.string().min(1),
  currency: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"])
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
