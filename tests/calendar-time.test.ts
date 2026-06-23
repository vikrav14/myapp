import { describe, expect, it } from "vitest";

import { parseCalendarSchedule } from "../src/services/calendar-time.service.js";
import { mauritiusLocalToUtc } from "../src/services/reminder-time.service.js";

describe("parseCalendarSchedule", () => {
  it("parses an event on a weekday at a clock time", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 10, minute: 0 });
    const parsed = parseCalendarSchedule("team sync on friday at 3pm", after);

    expect(parsed).not.toBeNull();
    expect(parsed?.consumedText).toBe("team sync");
    expect(parsed?.startsAt.getUTCHours()).toBe(11);
  });

  it("parses tomorrow events", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 10, minute: 0 });
    const parsed = parseCalendarSchedule("dentist tomorrow at 10am", after);

    expect(parsed).not.toBeNull();
    expect(parsed?.consumedText).toBe("dentist");
  });
});
