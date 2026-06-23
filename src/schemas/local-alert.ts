import { z } from "zod";

export const LOCAL_ALERT_TYPES = [
  "school_closure",
  "heavy_rain",
  "cyclone",
  "flood",
  "traffic_disruption",
  "general_advisory"
] as const;

export type LocalAlertType = (typeof LOCAL_ALERT_TYPES)[number];

export const localAlertClassificationSchema = z.object({
  is_actionable_alert: z.boolean(),
  alert_type: z.enum(LOCAL_ALERT_TYPES),
  severity: z.enum(["high", "medium"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  advice_text: z.string().min(1),
  regions: z.array(z.string()).optional()
});

export type LocalAlertClassification = z.infer<typeof localAlertClassificationSchema>;

export const localAlertClassificationJsonSchema = {
  type: "object",
  properties: {
    is_actionable_alert: { type: "boolean" },
    alert_type: { type: "string", enum: [...LOCAL_ALERT_TYPES] },
    severity: { type: "string", enum: ["high", "medium"] },
    title: { type: "string" },
    summary: { type: "string" },
    advice_text: { type: "string" },
    regions: { type: "array", items: { type: "string" } }
  },
  required: ["is_actionable_alert", "alert_type", "severity", "title", "summary", "advice_text"]
} as const;
