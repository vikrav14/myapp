import { describe, expect, it } from "vitest";

import { parseInboundMessage } from "../src/services/whatsapp.service.js";
import {
  buildArchetypePickerInteractive,
  buildReminderDeliveryInteractive,
  buildSundayRatingInteractive,
  resolveInteractiveReplyId
} from "../src/services/whatsapp-interactive.service.js";

describe("resolveInteractiveReplyId", () => {
  it("maps archetype and rating taps to text commands", () => {
    expect(resolveInteractiveReplyId("archetype_student")).toBe("Student Grind");
    expect(resolveInteractiveReplyId("rate_4")).toBe("rate 4");
    expect(resolveInteractiveReplyId("topics_ok")).toBe("OK");
    expect(resolveInteractiveReplyId("help_focus")).toBe("my focus");
    expect(resolveInteractiveReplyId("reminder_done")).toBe("done");
    expect(resolveInteractiveReplyId("reminder_snooze")).toBe("snooze 1h");
    expect(resolveInteractiveReplyId("reminder_snooze_15m")).toBe("snooze 15m");
    expect(resolveInteractiveReplyId("reminder_snooze_tomorrow")).toBe("snooze tomorrow");
    expect(resolveInteractiveReplyId("reminder_skip")).toBe("skip");
  });

  it("returns null for unknown ids", () => {
    expect(resolveInteractiveReplyId("unknown_button")).toBeNull();
  });
});

describe("interactive builders", () => {
  it("maps numeric replies to the documented 1–5 order", () => {
    const picker = buildArchetypePickerInteractive({ firstName: "Ava", isNewUser: true });
    expect(picker.sections?.[0]?.rows).toHaveLength(5);
    expect(picker.listButtonLabel).toBe("Pick vibe");
    expect(picker.sections?.[0]?.rows?.[0]?.title).toBe("Corporate / Career");
    expect(picker.sections?.[0]?.rows?.[3]?.title).toBe("Entrepreneur Mode");
  });

  it("builds sunday rating list with five scores", () => {
    const rating = buildSundayRatingInteractive();
    expect(rating.sections?.[0]?.rows).toHaveLength(5);
    expect(rating.sections?.[0]?.rows?.[4]?.id).toBe("rate_5");
  });

  it("builds reminder delivery actions as a list", () => {
    const reminder = buildReminderDeliveryInteractive("call mum");
    expect(reminder.body).toContain("call mum");
    expect(reminder.listButtonLabel).toBe("Respond");
    expect(reminder.sections?.[0]?.rows).toHaveLength(6);
    expect(reminder.sections?.[0]?.rows?.[0]?.id).toBe("reminder_done");
    expect(reminder.sections?.[0]?.rows?.[4]?.id).toBe("reminder_snooze_tomorrow");
  });
});

describe("parseInboundMessage interactive", () => {
  it("parses button reply payloads", () => {
    const parsed = parseInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "23052525252",
                    id: "wamid-btn-1",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "rate_4",
                        title: "4 — Solid"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(parsed?.kind).toBe("interactive");
    expect(parsed?.interactiveReplyId).toBe("rate_4");
    expect(parsed?.text).toBe("rate 4");
  });

  it("parses list reply payloads", () => {
    const parsed = parseInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "23052525252",
                    id: "wamid-list-1",
                    type: "interactive",
                    interactive: {
                      type: "list_reply",
                      list_reply: {
                        id: "archetype_student",
                        title: "Student Grind"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(parsed?.kind).toBe("interactive");
    expect(parsed?.text).toBe("Student Grind");
  });
});
