import { describe, expect, it } from "vitest";

import { parseInboundMessage } from "../src/services/whatsapp.service.js";

describe("parseInboundMessage reactions", () => {
  it("parses WhatsApp reaction webhooks", () => {
    const parsed = parseInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Vik" } }],
                messages: [
                  {
                    from: "23052525252",
                    id: "wamid-reaction-1",
                    type: "reaction",
                    reaction: {
                      message_id: "wamid-activation",
                      emoji: "👍"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(parsed).toEqual({
      from: "23052525252",
      kind: "reaction",
      reaction: {
        emoji: "👍",
        targetMessageId: "wamid-activation"
      },
      messageId: "wamid-reaction-1",
      profileName: "Vik",
      rawPayload: expect.any(Object)
    });
  });

  it("ignores reaction removals", () => {
    const parsed = parseInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "23052525252",
                    id: "wamid-reaction-2",
                    type: "reaction",
                    reaction: {
                      message_id: "wamid-activation",
                      emoji: ""
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(parsed).toBeNull();
  });
});
