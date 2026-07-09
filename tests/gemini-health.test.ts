import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, fetchMock } = vi.hoisted(() => ({
  mockEnv: {
    GEMINI_MODEL: "gemini-2.5-flash",
    GOOGLE_AI_API_KEY: "test-google-ai-key"
  },
  fetchMock: vi.fn()
}));

vi.mock("../src/lib/env.js", () => ({
  env: mockEnv
}));

vi.stubGlobal("fetch", fetchMock);

const { probeGeminiHealth } = await import("../src/lib/gemini-health.js");

describe("gemini health probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.GOOGLE_AI_API_KEY = "test-google-ai-key";
  });

  it("reports missing API key", async () => {
    mockEnv.GOOGLE_AI_API_KEY = "";

    const report = await probeGeminiHealth();
    expect(report.status).toBe("error");
    expect(report.message).toContain("GOOGLE_AI_API_KEY");
  });

  it("reports HTTP failures from Gemini", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "API key not valid. Please pass a valid API key."
    });

    const report = await probeGeminiHealth();
    expect(report.status).toBe("error");
    expect(report.httpStatus).toBe(403);
    expect(report.message).toContain("API key not valid");
  });

  it("reports success when Gemini returns structured JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }]
      })
    });

    const report = await probeGeminiHealth();
    expect(report.status).toBe("ok");
    expect(report.latencyMs).not.toBeNull();
  });
});
