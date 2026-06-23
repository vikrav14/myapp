import { describe, expect, it } from "vitest";

import {
  computeNextDailyFireAt,
  computeNextOnceFireAt,
  computeNextWeeklyFireAt,
  getMauritiusLocalParts,
  mauritiusLocalToUtc
} from "../src/services/reminder-time.service.js";

describe("reminder time helpers", () => {
  it("computes the next one-time fire in Mauritius time", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 10, minute: 0 });
    const next = computeNextOnceFireAt({ hour: 18, minute: 0, after });

    const local = getMauritiusLocalParts(next);
    expect(local.hour).toBe(18);
    expect(local.minute).toBe(0);
    expect(local.day).toBe(22);
  });

  it("rolls a one-time reminder to the next day after the time passes", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 19, minute: 0 });
    const next = computeNextOnceFireAt({ hour: 18, minute: 0, after });
    const local = getMauritiusLocalParts(next);

    expect(local.day).toBe(23);
    expect(local.hour).toBe(18);
  });

  it("computes the next weekday-only reminder", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 21, hour: 12, minute: 0 });
    const next = computeNextDailyFireAt({
      hour: 8,
      minute: 0,
      after,
      weekdaysOnly: true
    });
    const local = getMauritiusLocalParts(next);

    expect(local.weekday).toBe(1);
    expect(local.hour).toBe(8);
  });

  it("computes the next weekly reminder on selected days", () => {
    const after = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 12, minute: 0 });
    const next = computeNextWeeklyFireAt({
      hour: 17,
      minute: 0,
      weekdays: [3],
      after
    });
    const local = getMauritiusLocalParts(next);

    expect(local.weekday).toBe(3);
    expect(local.hour).toBe(17);
  });
});
