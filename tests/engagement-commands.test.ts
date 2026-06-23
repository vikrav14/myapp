import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGeneratePersonalityFeedback = vi.fn();
const mockBuildRecentActivitySnapshot = vi.fn();
const mockLoadHabitStreakSnapshot = vi.fn();
const mockBuildDailyMicroLesson = vi.fn();
const mockHasEngagementDelivery = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();

vi.mock("../src/services/ai.service.js", () => ({
  generatePersonalityFeedback: mockGeneratePersonalityFeedback
}));

vi.mock("../src/services/engagement-stats.service.js", () => ({
  buildRecentActivitySnapshot: mockBuildRecentActivitySnapshot
}));

vi.mock("../src/services/habit-streak.service.js", () => ({
  loadHabitStreakSnapshot: mockLoadHabitStreakSnapshot,
  buildHabitStreakReply: vi.fn(() => "Current streak: 3 days")
}));

vi.mock("../src/services/micro-lesson.service.js", () => ({
  buildDailyMicroLesson: mockBuildDailyMicroLesson,
  buildOnDemandLessonReply: vi.fn((lesson: string) => `Today's insight:\n\n${lesson}`)
}));

vi.mock("../src/services/engagement-delivery.service.js", () => ({
  hasEngagementDelivery: mockHasEngagementDelivery
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

const { handleEngagementCommandMessage } = await import("../src/services/engagement-commands.service.js");

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
  weekly_focus_habit: "45 minutes deep study before noon",
  weekly_focus_set_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("handleEngagementCommandMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildRecentActivitySnapshot.mockResolvedValue({
      financeEntries: 2,
      totalSpent: 300,
      habitLogs: 3,
      successfulHabits: 2,
      completedTodos: 1,
      openTodos: 2,
      averageAnxiety: 3
    });
    mockGeneratePersonalityFeedback.mockResolvedValue("Roast copy");
    mockBuildDailyMicroLesson.mockResolvedValue("Small steps beat big guilt.");
    mockHasEngagementDelivery.mockResolvedValue(false);
  });

  it("returns the help menu", async () => {
    const result = await handleEngagementCommandMessage({
      user: activeUser,
      message: "help"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Mauri command menu");
    expect(result.reply).toContain("roast me");
  });

  it("returns weekly focus", async () => {
    const result = await handleEngagementCommandMessage({
      user: activeUser,
      message: "my focus"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("45 minutes deep study");
  });

  it("returns roast feedback", async () => {
    const result = await handleEngagementCommandMessage({
      user: activeUser,
      message: "roast me"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toBe("Roast copy");
    expect(mockGeneratePersonalityFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "roast" })
    );
  });
});

describe("help menu", () => {
  it("parses menu aliases", async () => {
    const { parseHelpCommand, buildQuickStartMenu } = await import("../src/services/help-menu.service.js");
    expect(parseHelpCommand("menu")).toBe(true);
    expect(buildQuickStartMenu()).toContain("help");
  });
});

describe("weekly focus defaults", () => {
  it("maps archetypes to one habit", async () => {
    const { defaultWeeklyFocusForArchetype } = await import("../src/services/weekly-focus.service.js");
    expect(defaultWeeklyFocusForArchetype("Student Grind")).toContain("study");
  });
});
