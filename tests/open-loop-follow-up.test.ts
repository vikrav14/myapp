import { describe, expect, it } from "vitest";

import {
  buildFollowUpDeliveryKey,
  buildLoopFingerprint,
  nextOpenLoopFollowUpTime,
  openLoopFollowUpTimeAfterDays,
  parseMyFollowUpsCommand,
  parseOpenLoopFollowUpToggle
} from "../src/services/open-loop-follow-up.service.js";

describe("open loop follow-up parsing", () => {
  it("parses follow-up toggle commands", () => {
    expect(parseOpenLoopFollowUpToggle("followups on")).toEqual({ enabled: true });
    expect(parseOpenLoopFollowUpToggle("follow ups off")).toEqual({ enabled: false });
    expect(parseOpenLoopFollowUpToggle("I spent 150 on food")).toBeNull();
  });

  it("parses my followups command", () => {
    expect(parseMyFollowUpsCommand("my followups")).toBe(true);
    expect(parseMyFollowUpsCommand("my follow ups")).toBe(true);
    expect(parseMyFollowUpsCommand("help")).toBe(false);
  });
});

describe("open loop follow-up scheduling helpers", () => {
  it("builds stable fingerprints for loop text", () => {
    const first = buildLoopFingerprint("Mentioned job interview on Friday");
    const second = buildLoopFingerprint("mentioned  job interview on friday");
    const third = buildLoopFingerprint("Different topic entirely");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("builds dedup delivery keys", () => {
    const key = buildFollowUpDeliveryKey(
      "11111111-1111-4111-8111-111111111111",
      buildLoopFingerprint("Interview Friday"),
      "2026-06-23T06:00:00.000Z"
    );

    expect(key).toContain("open_loop_followup:");
    expect(key).toContain("2026-06-23");
  });

  it("schedules the next follow-up slot at 10 AM Mauritius", () => {
    const slot = nextOpenLoopFollowUpTime(new Date("2026-06-22T22:00:00.000Z"));
    expect(slot).toContain("T");
    expect(new Date(slot).getTime()).toBeGreaterThan(new Date("2026-06-22T22:00:00.000Z").getTime());
  });

  it("schedules follow-ups N days out at the configured slot", () => {
    const inThreeDays = openLoopFollowUpTimeAfterDays(3, new Date("2026-06-22T06:00:00.000Z"));
    const inOneDay = openLoopFollowUpTimeAfterDays(1, new Date("2026-06-22T06:00:00.000Z"));

    expect(new Date(inThreeDays).getTime()).toBeGreaterThan(new Date(inOneDay).getTime());
  });
});
