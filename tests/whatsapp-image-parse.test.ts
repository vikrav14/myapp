import { describe, expect, it } from "vitest";

import { parseInboundMessage } from "../src/services/whatsapp.service.js";

describe("parseInboundMessage images", () => {
  it("parses direct image payloads", () => {
    const parsed = parseInboundMessage({
      from: "23052525252",
      imageUrl: "https://example.com/receipt.jpg",
      mimeType: "image/jpeg",
      messageId: "img-1"
    });

    expect(parsed).toEqual({
      from: "23052525252",
      kind: "image",
      messageId: "img-1",
      rawPayload: {
        from: "23052525252",
        imageUrl: "https://example.com/receipt.jpg",
        mimeType: "image/jpeg",
        messageId: "img-1"
      },
      image: {
        url: "https://example.com/receipt.jpg",
        mimeType: "image/jpeg",
        caption: undefined
      }
    });
  });

  it("parses Meta WhatsApp image webhook payloads", () => {
    const parsed = parseInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Ava" } }],
                messages: [
                  {
                    from: "23052525252",
                    id: "wamid-123",
                    type: "image",
                    image: {
                      id: "media-123",
                      mime_type: "image/jpeg",
                      caption: "lunch receipt"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(parsed?.kind).toBe("image");
    expect(parsed?.image?.mediaId).toBe("media-123");
    expect(parsed?.image?.caption).toBe("lunch receipt");
    expect(parsed?.profileName).toBe("Ava");
  });
});
