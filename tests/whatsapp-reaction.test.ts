import { describe, expect, it } from "vitest";

import {
  isLikelyCommandMessage,
  pickInboundReactionEmoji
} from "../src/services/whatsapp-reaction.service.js";

describe("pickInboundReactionEmoji", () => {
  it("reacts to receipt images with eyes", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "image",
        isCommand: false,
        onboardingActive: false
      })
    ).toBe("👀");
  });

  it("reacts to voice notes with ear", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "audio",
        isCommand: false,
        onboardingActive: false
      })
    ).toBe("👂");
  });

  it("reacts to emotional vents with heart", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "text",
        messageText: "Honestly I'm so stressed about exams and can't cope",
        isCommand: false,
        onboardingActive: false
      })
    ).toBe("❤️");
  });

  it("reacts to wins with fire", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "text",
        messageText: "Just finished my assignment and crushed it",
        isCommand: false,
        onboardingActive: false
      })
    ).toBe("🔥");
  });

  it("skips commands and short greetings", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "text",
        messageText: "remind me to gym at 6pm",
        isCommand: true,
        onboardingActive: false
      })
    ).toBeNull();

    expect(
      pickInboundReactionEmoji({
        kind: "text",
        messageText: "hey",
        isCommand: false,
        onboardingActive: false
      })
    ).toBeNull();
  });

  it("skips during onboarding", () => {
    expect(
      pickInboundReactionEmoji({
        kind: "text",
        messageText: "I spent 150 on mine frite today",
        isCommand: false,
        onboardingActive: true
      })
    ).toBeNull();
  });
});

describe("isLikelyCommandMessage", () => {
  it("detects help and remind commands", () => {
    expect(isLikelyCommandMessage("help")).toBe(true);
    expect(isLikelyCommandMessage("remind me to call mum at 6pm")).toBe(true);
    expect(isLikelyCommandMessage("I spent 150 on food")).toBe(false);
  });
});
