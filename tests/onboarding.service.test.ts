import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildLockedReplyForUser = vi.fn();
const mockUpdateUserState = vi.fn();

vi.mock("../src/services/paywall.service.js", () => ({
  buildLockedReplyForUser: mockBuildLockedReplyForUser
}));

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

const { enforceAccessPolicy } = await import("../src/services/onboarding.service.js");

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-01-08T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("enforceAccessPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildLockedReplyForUser.mockResolvedValue("Vault locked. Pay to unlock.");
  });

  it("allows active trial users through", async () => {
    const result = await enforceAccessPolicy({
      ...baseUser,
      trial_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

    expect(result.handled).toBe(false);
    expect(mockBuildLockedReplyForUser).not.toHaveBeenCalled();
  });

  it("locks expired trial users and returns a paywall reply", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...baseUser,
      subscription_status: "Locked",
      locked_at: "2026-06-22T00:00:00.000Z"
    });

    const result = await enforceAccessPolicy(
      {
        ...baseUser,
        trial_ends_at: "2020-01-01T00:00:00.000Z"
      },
      "req-lock-1"
    );

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Vault locked");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      baseUser.id,
      expect.objectContaining({
        subscription_status: "Locked"
      })
    );
    expect(mockBuildLockedReplyForUser).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_status: "Locked" }),
      "req-lock-1"
    );
  });

  it("returns a paywall reply for already locked users", async () => {
    const result = await enforceAccessPolicy(
      {
        ...baseUser,
        subscription_status: "Locked",
        locked_at: "2026-06-22T00:00:00.000Z"
      },
      "req-lock-2"
    );

    expect(result.handled).toBe(true);
    expect(mockUpdateUserState).not.toHaveBeenCalled();
    expect(mockBuildLockedReplyForUser).toHaveBeenCalled();
  });
});
