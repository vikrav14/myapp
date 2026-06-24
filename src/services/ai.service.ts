import { env } from "../lib/env.js";
import { mauriBrainDumpJsonSchema, mauriBrainDumpSchema, parseStructuredJson } from "../schemas/extraction.js";
import {
  localAlertClassificationJsonSchema,
  localAlertClassificationSchema,
  type LocalAlertClassification
} from "../schemas/local-alert.js";
import {
  receiptExtractionJsonSchema,
  receiptExtractionSchema,
  type ReceiptExtraction
} from "../schemas/receipt.js";
import {
  parseUserMindSnapshot,
  userMindSnapshotJsonSchema,
  type UserMindSnapshotPayload
} from "../schemas/user-mind.js";
import type {
  MauriBrainDumpExtraction,
  MauriUser,
  UserContextSnapshot,
  WeeklyDiagnosticSummary
} from "../types.js";
import type { UserMindReflectionInput } from "./user-mind-data.service.js";
import { buildReflectionPayloadSummary, formatUserMindForPrompt } from "./user-mind-prompt.js";

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

type GeminiPart =
  | {
      text: string;
    }
  | {
      inlineData: {
        mimeType: string;
        data: string;
      };
    };

async function callGemini(input: {
  prompt?: string | undefined;
  parts?: GeminiPart[] | undefined;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: object;
}): Promise<string> {
  const { prompt, parts, responseMimeType, responseSchema } = input;
  const requestParts = parts ?? (prompt ? [{ text: prompt }] : []);

  if (requestParts.length === 0) {
    throw new Error("Gemini request requires prompt text or parts.");
  }

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
            parts: requestParts
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

export async function transcribeVoiceNote(input: {
  audioBuffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const { audioBuffer, mimeType } = input;
  const prompt = `
Transcribe this voice note into clean plain text.

Rules:
- Preserve the speaker's wording as closely as possible.
- Remove filler only when it does not change meaning.
- Keep Mauritian Creole, French, and English naturally if they appear.
- Do not summarize.
- Do not explain.
- Return only the transcript text.
`;

  return callGemini({
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: audioBuffer.toString("base64")
        }
      }
    ],
    responseMimeType: "text/plain"
  });
}

export async function embedText(input: {
  text: string;
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
}): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBEDDING_MODEL}:embedContent?key=${env.GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: {
          role: "user",
          parts: [{ text: input.text }]
        },
        taskType: input.taskType,
        outputDimensionality: env.EMBEDDING_OUTPUT_DIMENSIONS
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    embedding?: {
      values?: number[];
    };
  };

  const values = data.embedding?.values;
  if (!values?.length) {
    throw new Error("Embedding model returned no values.");
  }

  return values;
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

export async function generateUserMindSnapshot(
  reflectionInput: UserMindReflectionInput
): Promise<UserMindSnapshotPayload> {
  const payload = buildReflectionPayloadSummary(reflectionInput);
  const prompt = `You are Mauri's off-peak reflection engine for a Mauritian lifestyle companion on WhatsApp.

Synthesize a durable understanding of this user from the data below.
This snapshot will be injected into future replies so Mauri feels like a mate who knows them.

Rules:
- Ground every field in the provided data only. Do not invent facts.
- If signal is thin, say so plainly and keep arrays short.
- Write for a Mauritian young professional / student context when relevant.
- personality_notes should capture communication style, stress triggers, and what tone lands (direct, gentle, humour, etc.).
- advice_preferences: how Mauri should coach this person (e.g. empathise first, then one concrete move).
- things_to_avoid: reply patterns that would feel wrong for this user (preachy, generic, ignoring money stress, etc.).
- active_goals, recent_wins, open_loops: short phrase items only.
- Merge useful signal from previous_mind_snapshot when still valid; drop stale items.

Reflection data:
${JSON.stringify(payload, null, 2)}`;

  const rawJson = await callGemini({
    prompt,
    responseMimeType: "application/json",
    responseSchema: userMindSnapshotJsonSchema
  });

  return parseUserMindSnapshot(rawJson);
}

export async function generateOpenLoopFollowUpMessage(input: {
  user: MauriUser;
  loopText: string;
}): Promise<string> {
  const prompt = `You are Mauri in a private WhatsApp thread for Mauritians.
You are gently following up on something the user mentioned earlier.

Rules:
- 2 short paragraphs max.
- Warm, grounded, zero guilt.
- Reference the open loop naturally without quoting it word-for-word.
- Make clear they do not have to debrief if they do not want to.
- No bullet lists. No numbered steps. No "As an AI".
- Sound like a real mate checking in.

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}
Open loop: ${input.loopText}

Reply in plain text only.`;

  return callGemini({
    prompt,
    responseMimeType: "text/plain"
  });
}

export async function generateConversationalReply(input: {
  user: MauriUser;
  message: string;
  extraction: MauriBrainDumpExtraction;
  context: UserContextSnapshot;
}): Promise<string> {
  const { user, message, extraction, context } = input;

  const mindBlock =
    context.userMind !== null
      ? `Pre-built understanding of this user (refreshed off-peak — trust this first):
${formatUserMindForPrompt(context.userMind)}
Last refreshed: ${context.userMindGeneratedAt ?? "unknown"}`
      : "Pre-built user understanding: not available yet — rely on recent logs and memories below.";

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
- You can answer general questions too — always weave in what you know about this user when it helps.

User profile:
First name: ${user.first_name ?? "Unknown"}
Archetype: ${user.archetype}
Subscription status: ${user.subscription_status}
Morning brief tags: ${user.topic_preferences.join(", ") || "not set"}

${mindBlock}

Fresh same-day context (use alongside the pre-built understanding):
Recent pending todos:
${JSON.stringify(context.pendingTodos)}

Recent finance logs:
${JSON.stringify(context.recentFinance)}

Recent habit logs:
${JSON.stringify(context.recentHabits)}

Recent emotional logs:
${JSON.stringify(context.recentEmotions)}

Semantically relevant older memories:
${JSON.stringify(context.semanticMemories)}

Structured extraction from the latest message:
${JSON.stringify(extraction)}

Latest user message:
${message}

Reply in plain text only.
If the user shared stress, respond with empathy first.
If they implicitly logged progress, acknowledge it naturally.
If they seem scattered, help them narrow to the next move without sounding robotic.
Honor advice_preferences and things_to_avoid from the pre-built understanding when present.
`;

  return callGemini({
    prompt: replyPrompt,
    responseMimeType: "text/plain"
  });
}

export async function generateWeeklyDiagnosticCopy(input: {
  user: MauriUser;
  summary: WeeklyDiagnosticSummary;
}): Promise<string> {
  const { user, summary } = input;

  const prompt = `
You are Mauri.
You are writing a Sunday diagnostic report for a user inside a private WhatsApp thread.

Voice rules:
- No bullet lists.
- No numbered lists.
- No robotic headings.
- No "As an AI".
- Short paragraphs.
- Sharp, warm, grounded.
- Sound local, real, and emotionally intelligent.

User:
First name: ${user.first_name ?? "Unknown"}
Archetype: ${user.archetype}
Subscription status: ${user.subscription_status}

Weekly summary:
${JSON.stringify(summary)}

Write a compact weekly diagnostic.
Reflect what moved, what slipped, and what pattern is quietly shaping their week.
If momentum is decent, say it clean.
If the week was messy, be honest without being harsh.
If trial_cliffhanger is true, end with a subtle but irresistible cliffhanger that hints deeper tracking gets locked after trial unless they unlock premium.

Reply in plain text only.
`;

  return callGemini({
    prompt,
    responseMimeType: "text/plain"
  });
}

export async function generatePersonalityFeedback(input: {
  user: MauriUser;
  mode: "roast" | "hype";
  snapshot: {
    financeEntries: number;
    totalSpent: number;
    habitLogs: number;
    successfulHabits: number;
    completedTodos: number;
    openTodos: number;
    averageAnxiety: number | null;
  };
  weeklyFocus: string | null;
}): Promise<string> {
  const tone =
    input.mode === "roast"
      ? "Playfully sharp, honest, Mauritian peer energy. No cruelty. No bullet lists."
      : "Warm, hype them up, celebrate real wins only. No fake positivity. No bullet lists.";

  const prompt = `
You are Mauri in a private WhatsApp thread for Mauritians.
Mode: ${input.mode}
${tone}
No "As an AI".
Short paragraphs only.
Use Rs for money when relevant.

User:
First name: ${input.user.first_name ?? "Unknown"}
Archetype: ${input.user.archetype}
Weekly focus: ${input.weeklyFocus ?? "not set"}

Recent activity snapshot:
${JSON.stringify(input.snapshot)}

Write a compact ${input.mode} based on their actual data.
If data is thin, say that directly and push one concrete next move.
Reply in plain text only.
`;

  return callGemini({
    prompt,
    responseMimeType: "text/plain"
  });
}

export async function generateMicroLesson(input: {
  user: MauriUser;
  weeklyFocus: string | null;
}): Promise<string> {
  const prompt = `
You are Mauri.
Write one 2-minute life insight for a Mauritian user on WhatsApp.

Rules:
- One short paragraph, max 80 words.
- Psychology-informed, practical, not preachy.
- Tie to their archetype and weekly focus when possible.
- No bullet lists. No "As an AI".

User archetype: ${input.user.archetype}
Weekly focus: ${input.weeklyFocus ?? "general balance"}

Reply in plain text only.
`;

  return callGemini({
    prompt,
    responseMimeType: "text/plain"
  });
}

export async function generateMemoryResurfaceMessage(input: {
  user: MauriUser;
  memoryText: string;
  memorySource: "conversation_memory" | "insight_memory" | "todo";
  weeklyFocus: string | null;
}): Promise<string> {
  const prompt = `
You are Mauri in a private WhatsApp thread for Mauritians.
You are gently resurfacing something the user shared earlier.

Rules:
- 2 short paragraphs max.
- Warm, grounded, not creepy.
- Reference the memory naturally without quoting it word-for-word.
- Ask one light question or suggest one small next move.
- No bullet lists. No "As an AI".

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}
Weekly focus: ${input.weeklyFocus ?? "not set"}
Memory source: ${input.memorySource}
Memory: ${input.memoryText}

Reply in plain text only.
`;

  return callGemini({
    prompt,
    responseMimeType: "text/plain"
  });
}

export async function extractReceiptFromImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
  caption?: string | undefined;
}): Promise<ReceiptExtraction> {
  const prompt = `
You are Mauri's receipt scanner for Mauritius.

Read this receipt or payment screenshot and extract spending details.

Rules:
- Amount must be in Mauritian Rupees (Rs / MUR). Use the final total paid.
- Merchant is the shop, restaurant, or service name.
- Category should be one of: Food, Transport, Shopping, Bills, Health, Entertainment, Education, Other.
- items_summary is a short plain-text list of what was bought.
- confidence is high only when amount and merchant are clearly visible.
- If this is not a receipt or payment proof, set confidence to low and make your best guess.

${input.caption ? `User caption: ${input.caption}` : ""}

Return JSON only.
`;

  const rawJson = await callGemini({
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType: input.mimeType,
          data: input.imageBuffer.toString("base64")
        }
      }
    ],
    responseMimeType: "application/json",
    responseSchema: receiptExtractionJsonSchema
  });

  return receiptExtractionSchema.parse(parseStructuredJson(rawJson));
}

export async function classifyLocalAlertArticle(input: {
  title: string;
  summary: string;
  source: string;
  url: string;
  matchedKeywords: string[];
}): Promise<LocalAlertClassification> {
  const prompt = `You are Mauri's urgent local alert classifier for Mauritius.

Decide whether this news item should trigger an immediate WhatsApp alert to Mauritian users.

High-priority examples:
- Government or Met Service heavy rain / cyclone advisories
- School closures or class suspensions (often after overnight "avis de grosses pluies")
- Serious flooding or major traffic disruption

Rules:
- is_actionable_alert = true only when ordinary Mauritians should change plans today (keep kids home, avoid roads, prepare for cyclone).
- Ignore routine politics, crime, sports, celebrity gossip, and generic weather chat with no advisory impact.
- alert_type:
  - school_closure — schools/classes closed or parents told to keep children home
  - heavy_rain — avis de grosses pluies, heavy rain warning, torrential rain advisory
  - cyclone — cyclone watch/warning/class
  - flood — flooding, inundation, blocked roads from water
  - traffic_disruption — major road closure/accident affecting commute
  - general_advisory — other official urgent local advisory
- severity high for school closures, cyclone, dangerous flooding; medium for softer advisories.
- advice_text: 1-2 short sentences telling a parent or commuter what to do right now. Plain Mauritian English. No bullet lists.

Article source: ${input.source}
Matched keywords: ${input.matchedKeywords.join(", ")}
Title: ${input.title}
Summary: ${input.summary}
URL: ${input.url}

Return JSON only.`;

  const rawJson = await callGemini({
    prompt,
    responseMimeType: "application/json",
    responseSchema: localAlertClassificationJsonSchema
  });

  return localAlertClassificationSchema.parse(parseStructuredJson(rawJson));
}
