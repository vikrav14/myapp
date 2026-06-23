import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { InboundMessage, MauriUser } from "../types.js";
import { extractReceiptFromImage } from "./ai.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { buildPaydayRunwaySnippet, loadPayCycleSpend } from "./payday-runway.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { downloadInboundImage } from "./whatsapp.service.js";

export interface ReceiptScanResult {
  handled: boolean;
  reply?: string | undefined;
}

function roundRs(value: number): number {
  return Math.round(value);
}

export async function handleReceiptImageMessage(input: {
  user: MauriUser;
  message: InboundMessage;
  requestId?: string | undefined;
}): Promise<ReceiptScanResult> {
  if (!env.RECEIPT_SCAN_ENABLED || input.message.kind !== "image") {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first, then you can snap receipts here."
    };
  }

  if (!isReminderEligible(input.user)) {
    return {
      handled: true,
      reply: "Receipt scanning is part of your Mauri trial or subscription. Reply pay to unlock access."
    };
  }

  const { imageBuffer, mimeType, mediaId } = await downloadInboundImage(input.message);
  const extraction = await extractReceiptFromImage({
    imageBuffer,
    mimeType,
    caption: input.message.image?.caption
  });

  if (extraction.confidence === "low" && extraction.amount <= 0) {
    return {
      handled: true,
      reply:
        "I couldn't read that as a receipt. Try a clearer photo of the total, or type: I spent 150 on mine frite."
    };
  }

  const rawSourceText = `Receipt at ${extraction.merchant}: ${extraction.items_summary}`;
  const { data: financeLog, error: financeError } = await supabase
    .from("finance_logs")
    .insert({
      user_id: input.user.id,
      amount: extraction.amount,
      category: extraction.category,
      context_tags: ["receipt_scan"],
      raw_source_text: rawSourceText
    })
    .select("id")
    .single();

  if (financeError) {
    throw new Error(`Failed to store receipt finance log: ${financeError.message}`);
  }

  const { error: scanError } = await supabase.from("receipt_scans").insert({
    user_id: input.user.id,
    source_message_id: input.message.messageId ?? null,
    media_id: mediaId,
    merchant: extraction.merchant,
    amount: extraction.amount,
    category: extraction.category,
    items_summary: extraction.items_summary,
    finance_log_id: financeLog.id,
    raw_extraction: extraction
  });

  if (scanError) {
    throw new Error(`Failed to store receipt scan: ${scanError.message}`);
  }

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "receipt_scanned",
    userId: input.user.id,
    entityType: "receipt_scan",
    entityId: String(financeLog.id),
    message: "User receipt scanned into finance log.",
    metadata: {
      merchant: extraction.merchant,
      amount: extraction.amount,
      category: extraction.category,
      confidence: extraction.confidence
    }
  });

  const cycleSpend = await loadPayCycleSpend(input.user);
  const runwaySnippet = buildPaydayRunwaySnippet(input.user, cycleSpend);

  const confidenceNote =
    extraction.confidence === "low" ? "\n\n(Amount is a best guess — reply with the correct total if I missed.)" : "";

  return {
    handled: true,
    reply: `Logged: Rs ${roundRs(extraction.amount)} at ${extraction.merchant}
Category: ${extraction.category}
${extraction.items_summary}

This pay cycle: Rs ${roundRs(cycleSpend.totalSpent)} spent.${runwaySnippet ? `\n${runwaySnippet}` : ""}${confidenceNote}

Snap any receipt or Juice screenshot — I'll track it.`
  };
}
