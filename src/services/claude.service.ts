import Anthropic from "@anthropic-ai/sdk";

import { env } from "../lib/env.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export interface ClaudeChatTurn {
  role: "user" | "assistant";
  text: string;
}

export async function generateClaudeReply(input: {
  system: string;
  history?: ClaudeChatTurn[] | undefined;
  userMessage: string;
  maxTokens?: number | undefined;
}): Promise<string> {
  const history = input.history ?? [];
  // The API requires the first message to be role "user" — drop any
  // leading assistant turns (can happen if a proactive message was the
  // first thing ever stored for this user).
  const firstUserIndex = history.findIndex((turn) => turn.role === "user");
  const trimmedHistory = firstUserIndex === -1 ? [] : history.slice(firstUserIndex);

  const messages: Anthropic.MessageParam[] = [
    ...trimmedHistory.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: input.userMessage }
  ];

  const response = await anthropic.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: input.maxTokens ?? 500,
    system: input.system,
    thinking: { type: "disabled" },
    messages
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Claude returned an empty response.");
  }

  return text;
}
