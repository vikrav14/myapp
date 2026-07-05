import { Router } from "express";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getRequestId } from "../lib/request-tracing.js";
import { extractStructuredContext, generateConversationalReply } from "../services/ai.service.js";
import { recordAuditEventBestEffort } from "../services/audit.service.js";
import { loadUserContext } from "../services/context.service.js";
import { completeInboundEvent, registerInboundEvent } from "../services/inbound-event.service.js";
import { persistExtraction } from "../services/logging.service.js";
import { storeConversationMemory } from "../services/memory.service.js";
import { handleLocalAlertsCommandMessage } from "../services/local-alerts-delivery.service.js";
import { handleFinanceCommandMessage } from "../services/payday-runway.service.js";
import { handleReceiptImageMessage } from "../services/receipt-scan.service.js";
import { handleCalendarMessage } from "../services/calendar.service.js";
import { handleEngagementCommandMessage } from "../services/engagement-commands.service.js";
import { handleUserMindCommandMessage } from "../services/user-mind.service.js";
import { handleServiceFeedbackMessage } from "../services/weekly-report-feedback.service.js";
import { handleMemoryResurfaceToggleMessage } from "../services/memory-resurfacing.service.js";
import { handleOpenLoopFollowUpMessage } from "../services/open-loop-follow-up.service.js";
import { handleProactiveCheckInMessage } from "../services/proactive-checkin.service.js";
import { enforceAccessPolicy, handleOnboardingMessage } from "../services/onboarding.service.js";
import { handleTopicPreferenceMessage } from "../services/morning-brief-preferences.service.js";
import { handleQuantumPickMessage } from "../services/quantum-pick.service.js";
import { handleReminderMessage } from "../services/reminder-schedule.service.js";
import { runSquadRelayAfterExtraction } from "../services/squad-relay.service.js";
import { handleSquadMessage } from "../services/squad.service.js";
import { getOrCreateUser } from "../services/user.service.js";
import { resolveInboundMessageText } from "../services/voice-note.service.js";
import { parseInboundMessage, sendMauriReply, sendWhatsAppMessage } from "../services/whatsapp.service.js";
import { reactToInboundMessageBestEffort } from "../services/whatsapp-reaction.service.js";
import { OUTBOUND_PAIR_DELAY_MS, sleep } from "../lib/mauri-voice.js";

export const whatsappRouter = Router();

async function finishInboundEvent(input: {
  provider: string;
  eventId?: string | undefined;
  requestId?: string | undefined;
}): Promise<void> {
  if (!input.eventId) {
    return;
  }

  await completeInboundEvent({
    provider: input.provider,
    eventId: input.eventId,
    requestId: input.requestId
  });
}

whatsappRouter.get("/", (request, response) => {
  const mode = request.query["hub.mode"];
  const token = request.query["hub.verify_token"];
  const challenge = request.query["hub.challenge"];

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    response.status(200).send(challenge);
    return;
  }

  response.status(403).json({ error: "Webhook verification failed." });
});

whatsappRouter.post("/", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const inboundMessage = parseInboundMessage(request.body);

    if (!inboundMessage) {
      response.status(200).json({ ok: true, ignored: true });
      return;
    }

    if (inboundMessage.messageId) {
      const inboundEvent = await registerInboundEvent({
        provider: "whatsapp",
        eventId: inboundMessage.messageId,
        eventKind: inboundMessage.kind,
        rawPayload: inboundMessage.rawPayload,
        requestId
      });

      if (inboundEvent.duplicate && !inboundEvent.reclaim) {
        response.status(200).json({
          ok: true,
          ignored: true,
          duplicate: true,
          sourceType: inboundMessage.kind,
          messageId: inboundMessage.messageId
        });
        return;
      }
    }

    const inboundEventId = inboundMessage.messageId;
    const finishInbound = () =>
      finishInboundEvent({
        provider: "whatsapp",
        eventId: inboundEventId,
        requestId
      });
    const respondOk = async (body: Record<string, unknown>) => {
      await finishInbound();
      response.status(200).json(body);
    };

    const { user: initialUser, isNewUser } = await getOrCreateUser(inboundMessage.from, inboundMessage.profileName);
    const accessPolicyResult = await enforceAccessPolicy(initialUser, requestId);

    let inboundReaction: { reacted: boolean; emoji?: string | undefined } = { reacted: false };
    if (!accessPolicyResult.handled) {
      inboundReaction = await reactToInboundMessageBestEffort({
        to: inboundMessage.from,
        inboundMessage,
        messageText:
          inboundMessage.kind === "text"
            ? inboundMessage.text
            : inboundMessage.kind === "image"
              ? inboundMessage.image?.caption
              : undefined,
        user: accessPolicyResult.user,
        requestId
      });
    }

    if (accessPolicyResult.handled && accessPolicyResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, accessPolicyResult.reply, {
        userId: accessPolicyResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "access_policy"
        }
      });

      await respondOk({
        ok: true,
        userId: accessPolicyResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: accessPolicyResult.user.onboarding_state,
        subscriptionStatus: accessPolicyResult.user.subscription_status,
        replyPreview: accessPolicyResult.reply
      });
      return;
    }

    if (inboundMessage.kind === "image") {
      try {
        const receiptResult = await handleReceiptImageMessage({
          user: accessPolicyResult.user,
          message: inboundMessage,
          requestId
        });

        if (receiptResult.handled && receiptResult.reply) {
          await sendWhatsAppMessage(inboundMessage.from, receiptResult.reply, {
            userId: accessPolicyResult.user.id,
            requestId,
            metadata: {
              sourceType: inboundMessage.kind,
              flow: "receipt_scan"
            }
          });

          await respondOk({
            ok: true,
            userId: accessPolicyResult.user.id,
            sourceType: inboundMessage.kind,
            onboardingState: accessPolicyResult.user.onboarding_state,
            subscriptionStatus: accessPolicyResult.user.subscription_status,
            replyPreview: receiptResult.reply
          });
          return;
        }
      } catch (error) {
        logger.error(
          {
            error,
            phoneNumber: inboundMessage.from,
            kind: inboundMessage.kind
          },
          "Failed to process receipt image."
        );

        const fallbackReply =
          "I couldn't read that receipt cleanly. Try a clearer photo of the total, or type: I spent 150 on mine frite.";

        await sendWhatsAppMessage(inboundMessage.from, fallbackReply, {
          userId: accessPolicyResult.user.id,
          requestId,
          metadata: {
            sourceType: inboundMessage.kind,
            flow: "receipt_scan_error"
          }
        });

        await respondOk({
          ok: true,
          userId: accessPolicyResult.user.id,
          sourceType: inboundMessage.kind,
          onboardingState: accessPolicyResult.user.onboarding_state,
          subscriptionStatus: accessPolicyResult.user.subscription_status,
          replyPreview: fallbackReply
        });
        return;
      }
    }

    let normalizedMessageText: string;
    let transcriptPreview: string | undefined;

    try {
      const resolvedInbound = await resolveInboundMessageText({
        userId: accessPolicyResult.user.id,
        message: inboundMessage,
        requestId
      });

      normalizedMessageText = resolvedInbound.messageText;
      transcriptPreview = resolvedInbound.transcriptRecord?.transcript_text;
    } catch (error) {
      logger.error(
        {
          error,
          phoneNumber: inboundMessage.from,
          kind: inboundMessage.kind
        },
        "Failed to resolve inbound message text."
      );

      const fallbackReply =
        inboundMessage.kind === "audio"
          ? "I couldn’t catch that voice note cleanly. Send it again, keep it a bit clearer, or type the main part here."
          : inboundMessage.kind === "image"
            ? "I couldn't process that image. Try sending the receipt photo again."
            : "I hit a processing issue on that message. Send it again and I’ll pick it up.";

      await sendWhatsAppMessage(inboundMessage.from, fallbackReply, {
        userId: accessPolicyResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "fallback_processing_error"
        }
      });

      await respondOk({
        ok: true,
        userId: accessPolicyResult.user.id,
        onboardingState: accessPolicyResult.user.onboarding_state,
        subscriptionStatus: accessPolicyResult.user.subscription_status,
        sourceType: inboundMessage.kind,
        replyPreview: fallbackReply
      });
      return;
    }

    const engagementResult = await handleEngagementCommandMessage({
      user: accessPolicyResult.user,
      message: normalizedMessageText,
      requestId
    });

    if (engagementResult.handled && (engagementResult.reply || engagementResult.interactive)) {
      await sendMauriReply(
        inboundMessage.from,
        {
          text: engagementResult.reply,
          interactive: engagementResult.interactive
        },
        {
          userId: accessPolicyResult.user.id,
          requestId,
          metadata: {
            sourceType: inboundMessage.kind,
            flow: "engagement_command"
          }
        }
      );

      await respondOk({
        ok: true,
        userId: accessPolicyResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: accessPolicyResult.user.onboarding_state,
        subscriptionStatus: accessPolicyResult.user.subscription_status,
        transcriptPreview,
        replyPreview: engagementResult.reply ?? engagementResult.interactive?.body
      });
      return;
    }

    const onboardingResult = await handleOnboardingMessage({
      user: accessPolicyResult.user,
      isNewUser,
      message: normalizedMessageText
    });

    if (onboardingResult.handled && (onboardingResult.reply || onboardingResult.interactive)) {
      await sendMauriReply(
        inboundMessage.from,
        {
          text: onboardingResult.reply,
          interactive: onboardingResult.interactive
        },
        {
          userId: onboardingResult.user.id,
          requestId,
          sendTextBeforeInteractive: onboardingResult.sendTextBeforeInteractive,
          metadata: {
            sourceType: inboundMessage.kind,
            flow: "onboarding"
          }
        }
      );

      await respondOk({
        ok: true,
        userId: onboardingResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: onboardingResult.user.onboarding_state,
        subscriptionStatus: onboardingResult.user.subscription_status,
        transcriptPreview,
        replyPreview: onboardingResult.reply ?? onboardingResult.interactive?.body
      });
      return;
    }

    const user = onboardingResult.user;

    const userMindResult = await handleUserMindCommandMessage({
      user,
      message: normalizedMessageText
    });

    if (userMindResult.handled && userMindResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, userMindResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "user_mind_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: userMindResult.reply
      });
      return;
    }

    const serviceFeedbackResult = await handleServiceFeedbackMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (serviceFeedbackResult.handled && serviceFeedbackResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, serviceFeedbackResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "service_feedback"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: serviceFeedbackResult.reply
      });
      return;
    }

    const financeResult = await handleFinanceCommandMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (financeResult.handled && financeResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, financeResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "finance_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: financeResult.reply
      });
      return;
    }

    const openLoopFollowUpResult = await handleOpenLoopFollowUpMessage({
      user,
      message: normalizedMessageText
    });

    if (openLoopFollowUpResult.handled && openLoopFollowUpResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, openLoopFollowUpResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "open_loop_followup_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: openLoopFollowUpResult.reply
      });
      return;
    }

    const proactiveCheckInResult = await handleProactiveCheckInMessage({
      user,
      message: normalizedMessageText
    });

    if (proactiveCheckInResult.handled && proactiveCheckInResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, proactiveCheckInResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "proactive_checkin_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: proactiveCheckInResult.reply
      });
      return;
    }

    const localAlertsResult = await handleLocalAlertsCommandMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (localAlertsResult.handled && localAlertsResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, localAlertsResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "local_alerts_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: localAlertsResult.reply
      });
      return;
    }

    const memoryResurfaceResult = await handleMemoryResurfaceToggleMessage({
      user,
      message: normalizedMessageText
    });

    if (memoryResurfaceResult.handled && memoryResurfaceResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, memoryResurfaceResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "memory_resurface_toggle"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: memoryResurfaceResult.reply
      });
      return;
    }

    const reminderResult = await handleReminderMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (reminderResult.handled && reminderResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, reminderResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "reminder_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: reminderResult.reply
      });
      return;
    }

    const calendarResult = await handleCalendarMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (calendarResult.handled && calendarResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, calendarResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "calendar_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: calendarResult.reply
      });
      return;
    }

    const topicPreferenceResult = await handleTopicPreferenceMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (topicPreferenceResult.handled && topicPreferenceResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, topicPreferenceResult.reply, {
        userId: topicPreferenceResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "morning_brief_topics"
        }
      });

      await respondOk({
        ok: true,
        userId: topicPreferenceResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: topicPreferenceResult.user.onboarding_state,
        subscriptionStatus: topicPreferenceResult.user.subscription_status,
        transcriptPreview,
        replyPreview: topicPreferenceResult.reply
      });
      return;
    }

    const quantumPickResult = await handleQuantumPickMessage({
      user: topicPreferenceResult.user,
      message: normalizedMessageText,
      requestId
    });

    if (quantumPickResult.handled && quantumPickResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, quantumPickResult.reply, {
        userId: topicPreferenceResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "quantum_pick"
        }
      });

      await respondOk({
        ok: true,
        userId: topicPreferenceResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: topicPreferenceResult.user.onboarding_state,
        subscriptionStatus: topicPreferenceResult.user.subscription_status,
        transcriptPreview,
        replyPreview: quantumPickResult.reply
      });
      return;
    }

    const squadResult = await handleSquadMessage({
      user: topicPreferenceResult.user,
      message: normalizedMessageText,
      requestId
    });

    if (squadResult.handled && squadResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, squadResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "squad_command"
        }
      });

      await respondOk({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: squadResult.reply
      });
      return;
    }

    const context = await loadUserContext(user.id, normalizedMessageText);

    try {
      await storeConversationMemory({
        userId: user.id,
        memoryType: "user_message",
        contentText: normalizedMessageText,
        sourceMessageId: inboundMessage.messageId,
        metadata: {
          sourceType: inboundMessage.kind,
          hadTranscript: Boolean(transcriptPreview)
        }
      });
    } catch (error) {
      logger.warn({ error, userId: user.id }, "Failed to store inbound conversation memory.");
    }
    const extraction = await extractStructuredContext(normalizedMessageText);

    await persistExtraction(user.id, extraction);
    await runSquadRelayAfterExtraction({
      user,
      extraction,
      requestId
    });

    const reply = await generateConversationalReply({
      user,
      message: normalizedMessageText,
      extraction,
      context
    });

    try {
      await storeConversationMemory({
        userId: user.id,
        memoryType: "assistant_reply",
        contentText: reply,
        metadata: {
          sourceType: "assistant",
          respondingTo: inboundMessage.kind
        }
      });
    } catch (error) {
      logger.warn({ error, userId: user.id }, "Failed to store assistant reply memory.");
    }

    if (inboundReaction.reacted) {
      await sleep(OUTBOUND_PAIR_DELAY_MS);
    }

    await sendWhatsAppMessage(inboundMessage.from, reply, {
      userId: user.id,
      requestId,
      metadata: {
        sourceType: inboundMessage.kind,
        flow: "conversational_reply"
      }
    });

    logger.info(
      {
        userId: user.id,
        phoneNumber: inboundMessage.from,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        extraction
      },
      "Processed inbound WhatsApp message."
    );

    await recordAuditEventBestEffort({
      requestId,
      eventType: "inbound_message_processed",
      actorType: "user_message",
      userId: user.id,
      entityType: "whatsapp_message",
      entityId: inboundMessage.messageId,
      message: "Inbound WhatsApp message processed successfully.",
      metadata: {
        sourceType: inboundMessage.kind,
        hadTranscript: Boolean(transcriptPreview),
        extractionKeys: Object.keys(extraction)
      }
    });

    await respondOk({
      ok: true,
      userId: user.id,
      sourceType: inboundMessage.kind,
      onboardingState: user.onboarding_state,
      subscriptionStatus: user.subscription_status,
      transcriptPreview,
      extraction,
      replyPreview: reply
    });
  } catch (error) {
    next(error);
  }
});
