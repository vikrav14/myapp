import type { SemanticMemoryMatch, UserContextSnapshot } from "../types.js";

function formatShortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatPendingTodosForPrompt(
  todos: UserContextSnapshot["pendingTodos"]
): string {
  if (!todos.length) {
    return "None pending.";
  }

  return todos
    .map((todo) => {
      const due = todo.due_date ? `, due ${formatShortDate(todo.due_date)}` : "";
      return `${todo.task_description} [${todo.priority}]${due}`;
    })
    .join("; ");
}

export function formatFinanceLogsForPrompt(
  finance: UserContextSnapshot["recentFinance"],
  paydayRunwaySnippet: string | null
): string {
  const parts: string[] = [];

  if (paydayRunwaySnippet) {
    parts.push(paydayRunwaySnippet);
  }

  if (finance.length) {
    parts.push(
      finance.map((row) => `Rs ${row.amount} ${row.category} (${formatShortDate(row.logged_at)})`).join("; ")
    );
  }

  return parts.length ? parts.join(" | ") : "None logged recently.";
}

export function formatHabitLogsForPrompt(habits: UserContextSnapshot["recentHabits"]): string {
  if (!habits.length) {
    return "None logged recently.";
  }

  return habits
    .map((row) => {
      const status = row.is_success ? "done" : "missed";
      const duration = row.duration_minutes > 0 ? `, ${row.duration_minutes}m` : "";
      return `${row.activity_type} ${status}${duration}`;
    })
    .join("; ");
}

export function formatEmotionalLogsForPrompt(emotions: UserContextSnapshot["recentEmotions"]): string {
  if (!emotions.length) {
    return "None logged recently.";
  }

  return emotions
    .map((row) => {
      const score = row.anxiety_score === null ? "?" : String(row.anxiety_score);
      const driver = row.core_emotional_driver ? ` — ${row.core_emotional_driver}` : "";
      const vent = row.raw_unfiltered_vent.slice(0, 120);
      return `anxiety ${score}/5${driver}: "${vent}"`;
    })
    .join(" | ");
}

export function formatSemanticMemoriesForPrompt(memories: SemanticMemoryMatch[]): string {
  if (!memories.length) {
    return "None surfaced for this message.";
  }

  return memories
    .map((memory) => {
      const label = memory.source === "emotion_memory" ? "emotion" : memory.memory_type;
      return `[${label}] ${memory.text.slice(0, 180)}`;
    })
    .join("\n");
}

export function formatFreshContextForPrompt(context: UserContextSnapshot): string {
  return `Pending todos: ${formatPendingTodosForPrompt(context.pendingTodos)}
Recent spend: ${formatFinanceLogsForPrompt(context.recentFinance, context.paydayRunwaySnippet)}
Recent habits: ${formatHabitLogsForPrompt(context.recentHabits)}
Recent emotional logs: ${formatEmotionalLogsForPrompt(context.recentEmotions)}`;
}
