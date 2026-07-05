import { describe, expect, it } from "vitest";

import {
  looksLikeReminderAttempt,
  parseReminderCommand
} from "../src/services/reminder-parse.service.js";

describe("parseReminderCommand", () => {
  it("parses a one-time reminder", () => {
    const result = parseReminderCommand("remind me to call mum at 6pm");

    expect(result).toEqual({
      type: "create",
      label: "call mum",
      repeatKind: "once",
      hour: 18,
      minute: 0
    });
  });

  it("parses a daily reminder", () => {
    const result = parseReminderCommand("remind me to drink water daily at 8am");

    expect(result).toEqual({
      type: "create",
      label: "drink water",
      repeatKind: "daily",
      hour: 8,
      minute: 0
    });
  });

  it("parses a weekday reminder", () => {
    const result = parseReminderCommand("remind me to stand up every weekday at 9:30am");

    expect(result).toEqual({
      type: "create",
      label: "stand up",
      repeatKind: "weekdays",
      hour: 9,
      minute: 30
    });
  });

  it("parses a weekly reminder on one day", () => {
    const result = parseReminderCommand("remind me to church every sunday at 9am");

    expect(result).toEqual({
      type: "create",
      label: "church",
      repeatKind: "weekly",
      hour: 9,
      minute: 0,
      weekdays: [0]
    });
  });

  it("parses a weekly reminder on multiple days", () => {
    const result = parseReminderCommand("remind me to team sync every mon wed at 5pm");

    expect(result).toEqual({
      type: "create",
      label: "team sync",
      repeatKind: "weekly",
      hour: 17,
      minute: 0,
      weekdays: [1, 3]
    });
  });

  it("parses list and cancel commands", () => {
    expect(parseReminderCommand("my reminders")).toEqual({ type: "list" });
    expect(parseReminderCommand("cancel reminder 2")).toEqual({ type: "cancel", index: 2 });
  });

  it("parses reminder action replies", () => {
    expect(parseReminderCommand("done")).toEqual({ type: "done" });
    expect(parseReminderCommand("skip")).toEqual({ type: "skip" });
    expect(parseReminderCommand("snooze 1h")).toEqual({ type: "snooze", minutes: 60 });
    expect(parseReminderCommand("snooze 30m")).toEqual({ type: "snooze", minutes: 30 });
    expect(parseReminderCommand("snooze 15m")).toEqual({ type: "snooze", minutes: 15 });
    expect(parseReminderCommand("snooze 3h")).toEqual({ type: "snooze", minutes: 180 });
    expect(parseReminderCommand("snooze tomorrow")?.type).toBe("snooze");
    expect(parseReminderCommand("snooze")).toEqual({ type: "snooze", minutes: 60 });
  });

  it("ignores unrelated messages", () => {
    expect(parseReminderCommand("I spent 150 on mine frite")).toBeNull();
  });

  it("parses remind-me phrases embedded in longer chat", () => {
    const result = parseReminderCommand(
      "lets test reminders. ok. so remind me to drink water at 21.50 PM today"
    );

    expect(result).toEqual({
      type: "create",
      label: "drink water",
      repeatKind: "once",
      hour: 21,
      minute: 50
    });
  });

  it("parses conversational voice-style reminder requests", () => {
    expect(parseReminderCommand("Can you remind me to drink water at 11:55 PM tonight?")).toEqual({
      type: "create",
      label: "drink water",
      repeatKind: "once",
      hour: 23,
      minute: 55
    });

    expect(parseReminderCommand("Set a reminder to drink water at 11:55 PM")).toEqual({
      type: "create",
      label: "drink water",
      repeatKind: "once",
      hour: 23,
      minute: 55
    });

    expect(parseReminderCommand("remind me to drink water at 11 55 pm")).toEqual({
      type: "create",
      label: "drink water",
      repeatKind: "once",
      hour: 23,
      minute: 55
    });
  });

  it("parses relative-time reminders", () => {
    expect(parseReminderCommand("remind me to drink water in 15 minutes")).toEqual({
      type: "create_relative",
      label: "drink water",
      delayMinutes: 15
    });

    expect(parseReminderCommand("remind me to drink water in 1 hour")).toEqual({
      type: "create_relative",
      label: "drink water",
      delayMinutes: 60
    });
  });

  it("detects reminder-shaped messages for guardrail", () => {
    expect(looksLikeReminderAttempt("Can you remind me to drink water at 11:55 PM tonight?")).toBe(true);
    expect(looksLikeReminderAttempt("Set a reminder to drink water at 11:55 PM")).toBe(true);
    expect(looksLikeReminderAttempt("remind me to drink water in 15 minutes")).toBe(true);
    expect(looksLikeReminderAttempt("I spent 150 on mine frite")).toBe(false);
  });
});
