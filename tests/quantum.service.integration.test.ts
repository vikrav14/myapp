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

const { getQuantumRandomInt } = await import("../src/services/quantum.service.js");

describe("getQuantumRandomInt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the ANU API when quantum bytes are available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [4, 9, 12]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getQuantumRandomInt(1, 5);

    expect(result.source).toBe("quantum");
    expect(result.value).toBeGreaterThanOrEqual(1);
    expect(result.value).toBeLessThanOrEqual(5);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to local randomness when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    const result = await getQuantumRandomInt(1, 5);

    expect(result.source).toBe("fallback");
    expect(result.value).toBeGreaterThanOrEqual(1);
    expect(result.value).toBeLessThanOrEqual(5);
  });
});
