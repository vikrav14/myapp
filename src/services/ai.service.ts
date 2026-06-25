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
import type {
  MauriBrainDumpExtraction,
  MauriUser,
  UserContextSnapshot,
  WeeklyDiagnosticSummary,
  WeeklyFeedbackPromptContext
} from "../types.js";

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

function feedbackVariantGuidance(prompt: WeeklyFeedbackPromptContext): string {
  if (prompt.variant === "rating") {
    return "Ask for a simple 1–5 rating of how useful Mauri was this week. Mention they can reply rate 1 to rate 5. Keep it optional.";
  }

  if (prompt.variant === "context") {
    return "Invite honest context if Mauri is misunderstanding them. Mention they can reply mauri feedback with what to fix. No guilt.";
  }

  return "Early calibration: invite either rate 1–5 or mauri feedback with what Mauri should understand about them. Optional.";
}

export async function generateWeeklyFeedbackSection(input: {
  user: MauriUser;
  summary: WeeklyDiagnosticSummary;
  prompt: WeeklyFeedbackPromptContext;
}): Promise<string> {
  const reasonNotes: Record<NonNullable<WeeklyFeedbackPromptContext["reason"]>, string> = {
    early_calibration: "This is one of their first Sunday reports — calibrate how Mauri should read them.",
    low_signal: "They logged data but barely chatted — Mauri may be inferring wrong.",
    momentum_drop: "Momentum dropped sharply — check if Mauri tone or advice missed the mark.",
    quiet_power_user: "Long-time user, low chat volume — quick usefulness pulse.",
    periodic_pulse: "Routine quality check — keep it light."
  };

  const prompt = `
You are Mauri in a private WhatsApp thread for Mauritians.
You already wrote their Sunday diagnostic about THEIR week.
Now add a short closing section FROM MAURI (about Mauri's service, not their habits).

Voice rules:
- Start with "From Mauri" on its own line.
- 1–2 short paragraphs max.
- Warm, humble, not needy or survey-like.
- No bullet lists. No numbered lists. No "As an AI".
- Make clear replying is optional.

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}

Why we're asking (internal): ${input.prompt.reason ? reasonNotes[input.prompt.reason] : "quality pulse"}
${feedbackVariantGuidance(input.prompt)}

Weekly momentum: ${input.summary.momentum_score}/100

Reply in plain text only — the From Mauri section only.
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
