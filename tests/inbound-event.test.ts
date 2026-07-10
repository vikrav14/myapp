import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMaybeSingle = vi.fn();
const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ eq: mockSelectEq })) }));
const mockUpdateEq = vi.fn();
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockInsert = vi.fn();

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert
    }))
  }
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: vi.fn()
}));

const { registerInboundEvent } = await import("../src/services/inbound-event.service.js");

describe("registerInboundEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateEq.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  it("registers a new event as processing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await registerInboundEvent({
      provider: "whatsapp",
      eventId: "wamid-1"
    });

    expect(result).toEqual({ duplicate: false, reclaim: false });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "whatsapp",
        event_id: "wamid-1",
        status: "processing"
      })
    );
  });

  it("ignores duplicates that already finished processing", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "row-1", duplicate_count: 0, status: "processed" },
      error: null
    });

    const result = await registerInboundEvent({
      provider: "whatsapp",
      eventId: "wamid-1"
    });

    expect(result).toEqual({ duplicate: true, reclaim: false });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("ignores fresh duplicates still marked processing", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "row-1",
        duplicate_count: 0,
        status: "processing",
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      },
      error: null
    });

    const result = await registerInboundEvent({
      provider: "whatsapp",
      eventId: "wamid-1"
    });

    expect(result).toEqual({ duplicate: true, reclaim: false });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("reclaims stale duplicates still marked processing", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "row-1",
        duplicate_count: 0,
        status: "processing",
        updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      },
      error: null
    });

    const result = await registerInboundEvent({
      provider: "whatsapp",
      eventId: "wamid-1"
    });

    expect(result).toEqual({ duplicate: true, reclaim: true });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
