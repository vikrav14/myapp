import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = {
  QUANTUM_PICK_ENABLED: true,
  ANU_QUANTUM_API_KEY: "test-quantum-key",
  ANU_QUANTUM_API_URL: "https://api.quantumnumbers.anu.edu.au",
  QUANTUM_REQUEST_TIMEOUT_MS: 2500
};

vi.mock("../src/lib/env.js", () => ({
  env: mockEnv
}));

const mockRecordAuditEventBestEffort = vi.fn();
const mockGetQuantumRandomInt = vi.fn();

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

vi.mock("../src/services/quantum.service.js", () => ({
  getQuantumRandomInt: mockGetQuantumRandomInt
}));

const { parseQuantumPickCommand, handleQuantumPickMessage } = await import("../src/services/quantum-pick.service.js");
const { getQuantumRandomInt } = await import("../src/services/quantum.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"],
  morning_digest_enabled: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("parseQuantumPickCommand", () => {
  it("parses numeric quantum pick commands", () => {
    expect(parseQuantumPickCommand("quantum pick 1 5")).toEqual({ type: "range", min: 1, max: 5 });
    expect(parseQuantumPickCommand("lucky pick 1-5")).toEqual({ type: "range", min: 1, max: 5 });
    expect(parseQuantumPickCommand("pick for me 2 to 8")).toEqual({ type: "range", min: 2, max: 8 });
  });

  it("parses option lists and natural number requests", () => {
    expect(parseQuantumPickCommand("quantum pick Tribeca, Docker, Nandos")).toEqual({
      type: "options",
      choices: ["Tribeca", "Docker", "Nandos"]
    });
    expect(parseQuantumPickCommand("Mauri pick a number between 1 and 5")).toEqual({
      type: "range",
      min: 1,
      max: 5
    });
    expect(parseQuantumPickCommand("pick a number between 1 and 5")).toEqual({
      type: "range",
      min: 1,
      max: 5
    });
    expect(parseQuantumPickCommand("I spent 150 on food")).toBeNull();
  });
});

describe("handleQuantumPickMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
    mockGetQuantumRandomInt.mockResolvedValue({ value: 3, source: "quantum" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a quantum number pick reply", async () => {
    const result = await handleQuantumPickMessage({
      user: activeUser,
      message: "quantum pick 1 5"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("quantum lab");
    expect(result.reply).toContain("3");
    expect(mockGetQuantumRandomInt).toHaveBeenCalledWith(1, 5);
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "quantum_pick_used"
      })
    );
  });

  it("returns a quantum option pick reply", async () => {
    mockGetQuantumRandomInt.mockResolvedValue({ value: 2, source: "quantum" });

    const result = await handleQuantumPickMessage({
      user: activeUser,
      message: "quantum pick Tribeca, Docker, Nandos"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Docker");
    expect(mockGetQuantumRandomInt).toHaveBeenCalledWith(1, 3);
  });

  it("uses fallback copy when randomness is not quantum", async () => {
    mockGetQuantumRandomInt.mockResolvedValue({ value: 4, source: "fallback" });

    const result = await handleQuantumPickMessage({
      user: activeUser,
      message: "quantum pick 1 5"
    });

    expect(result.reply).toContain("backup randomness");
    expect(result.reply).toContain("4");
  });
});

describe("getQuantumRandomInt integration", () => {
  it("is mocked for handler tests", () => {
    expect(getQuantumRandomInt).toBeDefined();
  });
});
