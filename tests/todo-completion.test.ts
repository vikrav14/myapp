import { describe, expect, it } from "vitest";

import { matchesTodoTask } from "../src/services/logging.service.js";
import { appendProfileDeltaAck } from "../src/services/message-router.service.js";

describe("todo completion matching", () => {
  it("matches when the open todo contains the completion phrase", () => {
    expect(matchesTodoTask("Call the bank about the loan", "called the bank")).toBe(true);
  });

  it("matches on shared keyword overlap", () => {
    expect(matchesTodoTask("Send invoice to client", "send invoice")).toBe(true);
  });

  it("rejects unrelated tasks", () => {
    expect(matchesTodoTask("Buy groceries", "called the bank")).toBe(false);
  });
});

describe("profile delta ack append", () => {
  it("appends ack on a new line when present", () => {
    expect(appendProfileDeltaAck("Main reply.", "Got it — updated what you're working toward.")).toBe(
      "Main reply.\n\nGot it — updated what you're working toward."
    );
  });

  it("returns the original reply when ack is empty", () => {
    expect(appendProfileDeltaAck("Main reply.", null)).toBe("Main reply.");
  });
});
