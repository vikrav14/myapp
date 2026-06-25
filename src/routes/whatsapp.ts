import { Router } from "express";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getRequestId } from "../lib/request-tracing.js";
import { resolveConversationalAiResponse } from "../services/ai.service.js";
import { recordAuditEventBestEffort } from "../services/audit.service.js";
import { loadUserContext } from "../services/context.service.js";
import { registerInboundEvent } from "../services/inbound-event.service.js";
import { persistExtraction } from "../services/logging.service.js";
import { storeConversationMemory } from "../services/memory.service.js";
import { handleLocalAlertsCommandMessage } from "../services/local-alerts-delivery.service.js";
import { handleFinanceCommandMessage } from "../services/payday-runway.service.js";
import { handleReceiptImageMessage } from "../services/receipt-scan.service.js";
import { handleCalendarMessage } from "../services/calendar.service.js";
import { handleEngagementCommandMessage } from "../services/engagement-commands.service.js";
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
import { parseInboundMessage, sendWhatsAppMessage } from "../services/whatsapp.service.js";

export const whatsappRouter = Router();

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

      if (inboundEvent.duplicate) {
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

    const { user: initialUser, isNewUser } = await getOrCreateUser(inboundMessage.from, inboundMessage.profileName);
    const accessPolicyResult = await enforceAccessPolicy(initialUser, requestId);

    if (accessPolicyResult.handled && accessPolicyResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, accessPolicyResult.reply, {
        userId: accessPolicyResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "access_policy"
        }
      });

      response.status(200).json({
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

          response.status(200).json({
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

        response.status(200).json({
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

      response.status(200).json({
        ok: true,
        userId: accessPolicyResult.user.id,
        onboardingState: accessPolicyResult.user.onboarding_state,
        subscriptionStatus: accessPolicyResult.user.subscription_status,
        sourceType: inboundMessage.kind,
        replyPreview: fallbackReply
      });
      return;
    }

    const onboardingResult = await handleOnboardingMessage({
      user: accessPolicyResult.user,
      isNewUser,
      message: normalizedMessageText
    });

    if (onboardingResult.handled && onboardingResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, onboardingResult.reply, {
        userId: onboardingResult.user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "onboarding"
        }
      });

      if (onboardingResult.followUpReply) {
        await sendWhatsAppMessage(inboundMessage.from, onboardingResult.followUpReply, {
          userId: onboardingResult.user.id,
          requestId,
          metadata: {
            sourceType: inboundMessage.kind,
            flow: "onboarding_preview"
          }
        });
      }

      if (onboardingResult.discoveryReply) {
        await sendWhatsAppMessage(inboundMessage.from, onboardingResult.discoveryReply, {
          userId: onboardingResult.user.id,
          requestId,
          metadata: {
            sourceType: inboundMessage.kind,
            flow: "onboarding_discovery"
          }
        });
      }

      response.status(200).json({
        ok: true,
        userId: onboardingResult.user.id,
        sourceType: inboundMessage.kind,
        onboardingState: onboardingResult.user.onboarding_state,
        subscriptionStatus: onboardingResult.user.subscription_status,
        transcriptPreview,
        replyPreview: onboardingResult.reply
      });
      return;
    }

    const user = onboardingResult.user;

    const engagementResult = await handleEngagementCommandMessage({
      user,
      message: normalizedMessageText,
      requestId
    });

    if (engagementResult.handled && engagementResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, engagementResult.reply, {
        userId: user.id,
        requestId,
        metadata: {
          sourceType: inboundMessage.kind,
          flow: "engagement_command"
        }
      });

      response.status(200).json({
        ok: true,
        userId: user.id,
        sourceType: inboundMessage.kind,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        transcriptPreview,
        replyPreview: engagementResult.reply
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

      response.status(200).json({
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

    const context = await loadUserContext(user.id, normalizedMessageText, user);

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
    const { extraction, reply } = await resolveConversationalAiResponse({
      user,
      message: normalizedMessageText,
      context
    });

    await persistExtraction(user.id, extraction);
    await runSquadRelayAfterExtraction({
      user,
      extraction,
      requestId
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

    response.status(200).json({
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
