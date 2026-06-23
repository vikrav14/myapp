import { describe, expect, it } from "vitest";

import { parseIcalEvents } from "../src/services/ical-sync.service.js";

const SAMPLE_ICAL = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:event-1
SUMMARY:Team sync
DTSTART:20260623T150000
DTEND:20260623T160000
LOCATION:Port Louis
END:VEVENT
END:VCALENDAR`;

describe("parseIcalEvents", () => {
  it("parses a basic VEVENT block", () => {
    const events = parseIcalEvents(SAMPLE_ICAL);

    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe("event-1");
    expect(events[0]?.title).toBe("Team sync");
    expect(events[0]?.location).toBe("Port Louis");
    expect(events[0]?.startsAt).toBeInstanceOf(Date);
  });
});
