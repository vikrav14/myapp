import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeliverWhatsAppText = vi.fn();
const mockGetOutboundMessageById = vi.fn();
const mockGetRetryableOutboundMessages = vi.fn();
const mockIsRetryableStatus = vi.fn();
const mockMarkOutboundMessageFailed = vi.fn();
const mockMarkOutboundMessageRetrying = vi.fn();
const mockMarkOutboundMessageSent = vi.fn();

vi.mock("../src/services/whatsapp.service.js", () => ({
  deliverWhatsAppText: mockDeliverWhatsAppText
}));

vi.mock("../src/services/outbound-message.service.js", () => ({
  getOutboundMessageById: mockGetOutboundMessageById,
  getRetryableOutboundMessages: mockGetRetryableOutboundMessages,
  isRetryableStatus: mockIsRetryableStatus,
  markOutboundMessageFailed: mockMarkOutboundMessageFailed,
  markOutboundMessageRetrying: mockMarkOutboundMessageRetrying,
  markOutboundMessageSent: mockMarkOutboundMessageSent
}));

const { retryOutboundMessageById, runOutboundMessageRetryLoop } = await import(
  "../src/services/outbound-retry.service.js"
);

describe("outbound retry service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips retry when the message is missing", async () => {
    mockGetOutboundMessageById.mockResolvedValue(null);

    const result = await retryOutboundMessageById("message-1");

    expect(result).toEqual({
      messageId: "message-1",
      status: "skipped"
    });
    expect(mockMarkOutboundMessageRetrying).not.toHaveBeenCalled();
    expect(mockDeliverWhatsAppText).not.toHaveBeenCalled();
  });

  it("retries and marks sent on successful delivery", async () => {
    mockGetOutboundMessageById.mockResolvedValue({
      id: "message-2",
      status: "failed",
      phone_number: "23050000000",
      body: "hello again"
    });
    mockIsRetryableStatus.mockReturnValue(true);
    mockDeliverWhatsAppText.mockResolvedValue(undefined);
    mockMarkOutboundMessageSent.mockResolvedValue(undefined);

    const result = await retryOutboundMessageById("message-2");

    expect(result).toEqual({
      messageId: "message-2",
      status: "sent"
    });
    expect(mockMarkOutboundMessageRetrying).toHaveBeenCalledWith("message-2");
    expect(mockDeliverWhatsAppText).toHaveBeenCalledWith("23050000000", "hello again");
    expect(mockMarkOutboundMessageSent).toHaveBeenCalledWith("message-2");
    expect(mockMarkOutboundMessageFailed).not.toHaveBeenCalled();
  });

  it("marks failed when delivery throws before finalization", async () => {
    mockGetOutboundMessageById.mockResolvedValue({
      id: "message-3",
      status: "failed",
      phone_number: "23051111111",
      body: "retry me"
    });
    mockIsRetryableStatus.mockReturnValue(true);
    mockDeliverWhatsAppText.mockRejectedValue(new Error("Meta API unavailable"));
    mockMarkOutboundMessageFailed.mockResolvedValue(undefined);

    const result = await retryOutboundMessageById("message-3");

    expect(result).toEqual({
      messageId: "message-3",
      status: "failed"
    });
    expect(mockMarkOutboundMessageFailed).toHaveBeenCalledWith({
      messageId: "message-3",
      errorMessage: "Meta API unavailable"
    });
  });

  it("aggregates loop results across retryable messages", async () => {
    mockGetRetryableOutboundMessages.mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
      { id: "m3" }
    ]);

    mockGetOutboundMessageById
      .mockResolvedValueOnce({ id: "m1", status: "failed", phone_number: "1", body: "a" })
      .mockResolvedValueOnce({ id: "m2", status: "failed", phone_number: "2", body: "b" })
      .mockResolvedValueOnce(null);
    mockIsRetryableStatus.mockReturnValue(true);
    mockDeliverWhatsAppText
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Temporary send failure"));
    mockMarkOutboundMessageSent.mockResolvedValue(undefined);
    mockMarkOutboundMessageFailed.mockResolvedValue(undefined);

    const result = await runOutboundMessageRetryLoop(10);

    expect(result).toEqual({
      scanned: 3,
      sent: 1,
      failed: 1,
      skipped: 1
    });
  });
});
