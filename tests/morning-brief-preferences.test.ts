import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { handleTopicPreferenceMessage } = await import("../src/services/morning-brief-preferences.service.js");

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
  topic_preferences: ["Traffic", "Money", "LocalBuzz"] as const,
  morning_digest_enabled: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("handleTopicPreferenceMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
  });

  it("shows the user's current morning brief tags", async () => {
    const result = await handleTopicPreferenceMessage({
      user: activeUser,
      message: "my topics"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("#Traffic");
    expect(result.reply).toContain("#Money");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("updates morning brief tags from WhatsApp", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      topic_preferences: ["Traffic", "Tech", "Money"]
    });

    const result = await handleTopicPreferenceMessage({
      user: activeUser,
      message: "update topics Traffic Tech Money"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("updated");
    expect(mockUpdateUserState).toHaveBeenCalledWith(activeUser.id, {
      topic_preferences: ["Traffic", "Tech", "Money"],
      morning_digest_enabled: true
    });
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "morning_brief_topics_updated"
      })
    );
  });

  it("ignores unrelated messages", async () => {
    const result = await handleTopicPreferenceMessage({
      user: activeUser,
      message: "I spent 150 on mine frite"
    });

    expect(result.handled).toBe(false);
  });
});
