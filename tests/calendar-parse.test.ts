import { describe, expect, it } from "vitest";

import { parseCalendarCommand, parseMemoryResurfaceToggle } from "../src/services/calendar-parse.service.js";

describe("parseCalendarCommand", () => {
  it("parses calendar list commands", () => {
    expect(parseCalendarCommand("my calendar")).toEqual({ type: "list", scope: "all" });
    expect(parseCalendarCommand("calendar today")).toEqual({ type: "list", scope: "today" });
    expect(parseCalendarCommand("calendar week")).toEqual({ type: "list", scope: "week" });
  });

  it("parses calendar add commands", () => {
    expect(parseCalendarCommand("calendar add team sync on friday at 3pm")).toEqual({
      type: "add",
      title: "team sync",
      scheduleText: "team sync on friday at 3pm"
    });
    expect(parseCalendarCommand("calendar add dentist tomorrow at 10am")).toEqual({
      type: "add",
      title: "dentist",
      scheduleText: "dentist tomorrow at 10am"
    });
  });

  it("parses connect and cancel commands", () => {
    expect(parseCalendarCommand("connect calendar https://example.com/basic.ics")).toEqual({
      type: "connect",
      url: "https://example.com/basic.ics"
    });
    expect(parseCalendarCommand("cancel event 2")).toEqual({ type: "cancel", index: 2 });
    expect(parseCalendarCommand("sync calendar")).toEqual({ type: "sync" });
  });
});

describe("parseMemoryResurfaceToggle", () => {
  it("parses resurfacing toggles", () => {
    expect(parseMemoryResurfaceToggle("resurface on")).toEqual({ enabled: true });
    expect(parseMemoryResurfaceToggle("memory resurfacing off")).toEqual({ enabled: false });
  });
});
