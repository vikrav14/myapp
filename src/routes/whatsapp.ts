import { Router } from "express";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { extractStructuredContext, generateConversationalReply } from "../services/ai.service.js";
import { loadUserContext } from "../services/context.service.js";
import { persistExtraction } from "../services/logging.service.js";
import { enforceAccessPolicy, handleOnboardingMessage } from "../services/onboarding.service.js";
import { getOrCreateUser } from "../services/user.service.js";
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
    const inboundMessage = parseInboundMessage(request.body);

    if (!inboundMessage) {
      response.status(200).json({ ok: true, ignored: true });
      return;
    }

    const { user: initialUser, isNewUser } = await getOrCreateUser(inboundMessage.from, inboundMessage.profileName);
    const accessPolicyResult = await enforceAccessPolicy(initialUser);

    if (accessPolicyResult.handled && accessPolicyResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, accessPolicyResult.reply);

      response.status(200).json({
        ok: true,
        userId: accessPolicyResult.user.id,
        onboardingState: accessPolicyResult.user.onboarding_state,
        subscriptionStatus: accessPolicyResult.user.subscription_status,
        replyPreview: accessPolicyResult.reply
      });
      return;
    }

    const onboardingResult = await handleOnboardingMessage({
      user: accessPolicyResult.user,
      isNewUser,
      message: inboundMessage.text
    });

    if (onboardingResult.handled && onboardingResult.reply) {
      await sendWhatsAppMessage(inboundMessage.from, onboardingResult.reply);

      response.status(200).json({
        ok: true,
        userId: onboardingResult.user.id,
        onboardingState: onboardingResult.user.onboarding_state,
        subscriptionStatus: onboardingResult.user.subscription_status,
        replyPreview: onboardingResult.reply
      });
      return;
    }

    const user = onboardingResult.user;
    const context = await loadUserContext(user.id);
    const extraction = await extractStructuredContext(inboundMessage.text);

    await persistExtraction(user.id, extraction);

    const reply = await generateConversationalReply({
      user,
      message: inboundMessage.text,
      extraction,
      context
    });

    await sendWhatsAppMessage(inboundMessage.from, reply);

    logger.info(
      {
        userId: user.id,
        phoneNumber: inboundMessage.from,
        onboardingState: user.onboarding_state,
        subscriptionStatus: user.subscription_status,
        extraction
      },
      "Processed inbound WhatsApp message."
    );

    response.status(200).json({
      ok: true,
      userId: user.id,
      onboardingState: user.onboarding_state,
      subscriptionStatus: user.subscription_status,
      extraction,
      replyPreview: reply
    });
  } catch (error) {
    next(error);
  }
});
