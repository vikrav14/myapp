import { env } from "../lib/env.js";
import { mauriBrainDumpJsonSchema, mauriBrainDumpSchema, parseStructuredJson } from "../schemas/extraction.js";
import type { MauriBrainDumpExtraction, MauriUser, UserContextSnapshot } from "../types.js";

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

async function callGemini(input: {
  prompt: string;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: object;
}): Promise<string> {
  const { prompt, responseMimeType, responseSchema } = input;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: responseMimeType
          ? {
              responseMimeType,
              responseSchema
            }
          : undefined
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as GeminiTextResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

export async function extractStructuredContext(message: string): Promise<MauriBrainDumpExtraction> {
  const extractionPrompt = `
You are Mauri's parser engine.
Your only job is to convert the message into a single JSON object.
Do not add explanations.
Do not wrap the JSON in markdown.

Return only keys that are clearly supported by the message.
If a field is absent, omit it entirely.
The valid top-level keys are finance, todos, habits, emotions.

JSON shape:
{
  "finance": {
    "amount": number,
    "category": string,
    "context_tags": string[],
    "raw_source_text": string
  },
  "todos": [
    {
      "task_description": string,
      "due_date": string,
      "priority": "High" | "Medium" | "Low"
    }
  ],
  "habits": {
    "activity_type": string,
    "duration_minutes": number,
    "is_success": boolean,
    "context_note": string
  },
  "emotions": {
    "anxiety_score": 1-5,
    "core_emotional_driver": string,
    "raw_unfiltered_vent": string
  }
}

Message:
${message}
`;

  const rawJson = await callGemini({
    prompt: extractionPrompt,
    responseMimeType: "application/json",
    responseSchema: mauriBrainDumpJsonSchema
  });
  const parsed = parseStructuredJson(rawJson);

  return mauriBrainDumpSchema.parse(parsed);
}

export async function generateConversationalReply(input: {
  user: MauriUser;
  message: string;
  extraction: MauriBrainDumpExtraction;
  context: UserContextSnapshot;
}): Promise<string> {
  const { user, message, extraction, context } = input;

  const replyPrompt = `
You are Mauri.
You live inside a private WhatsApp thread for Mauritians.
You sound grounded, sharp, warm, direct.

Hard guardrails:
- No bullet lists.
- No numbered steps.
- No generic AI filler.
- No "As an AI".
- Keep paragraphs short and punchy.
- You can naturally understand English, French, and Mauritian Creole.
- Sound like a real peer, not a productivity bot.

User profile:
First name: ${user.first_name ?? "Unknown"}
Archetype: ${user.archetype}
Subscription status: ${user.subscription_status}

Recent pending todos:
${JSON.stringify(context.pendingTodos)}

Recent finance logs:
${JSON.stringify(context.recentFinance)}

Recent habit logs:
${JSON.stringify(context.recentHabits)}

Recent emotional logs:
${JSON.stringify(context.recentEmotions)}

Structured extraction from the latest message:
${JSON.stringify(extraction)}

Latest user message:
${message}

Reply in plain text only.
If the user shared stress, respond with empathy first.
If they implicitly logged progress, acknowledge it naturally.
If they seem scattered, help them narrow to the next move without sounding robotic.
`;

  return callGemini({
    prompt: replyPrompt,
    responseMimeType: "text/plain"
  });
}
