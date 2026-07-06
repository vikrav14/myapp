import type { UserMindSnapshotPayload } from "../schemas/user-mind.js";
import type { UserMindReflectionInput } from "./user-mind-data.service.js";

export function formatUserMindSnapshotForPrompt(snapshot: UserMindSnapshotPayload): string {
  const goals = snapshot.active_goals.length > 0 ? snapshot.active_goals.join("; ") : "none noted";
  const wins = snapshot.recent_wins.length > 0 ? snapshot.recent_wins.join("; ") : "none noted";
  const loops = snapshot.open_loops.length > 0 ? snapshot.open_loops.join("; ") : "none noted";
  const avoid = snapshot.things_to_avoid.length > 0 ? snapshot.things_to_avoid.join("; ") : "none noted";

  return `Life summary: ${snapshot.life_summary}
Personality / tone: ${snapshot.personality_notes}
Money pattern: ${snapshot.money_pattern}
Habit pattern: ${snapshot.habit_pattern}
Emotional pattern: ${snapshot.emotional_pattern}
Active goals: ${goals}
Recent wins: ${wins}
Open loops to follow up: ${loops}
Advice preferences: ${snapshot.advice_preferences}
Things to avoid in replies: ${avoid}`;
}

export function buildReflectionPayloadSummary(reflectionInput: UserMindReflectionInput): Record<string, unknown> {
  return {
    profile: {
      first_name: reflectionInput.user.first_name,
      archetype: reflectionInput.user.archetype,
      topic_preferences: reflectionInput.user.topic_preferences,
      weekly_focus_habit: reflectionInput.user.weekly_focus_habit,
      payday_day_of_month: reflectionInput.user.payday_day_of_month,
      monthly_income_rs: reflectionInput.user.monthly_income_rs
    },
    window: reflectionInput.window,
    finance_logs: reflectionInput.financeLogs,
    habit_logs: reflectionInput.habitLogs,
    todos: reflectionInput.todos,
    emotion_logs: reflectionInput.emotionLogs,
    conversation_samples: reflectionInput.conversationSamples,
    active_reminders: reflectionInput.activeReminders,
    upcoming_calendar_events: reflectionInput.upcomingCalendarEvents,
    user_mind_facts: reflectionInput.userMindFacts,
    previous_mind_snapshot: reflectionInput.previousMindSnapshot
  };
}
