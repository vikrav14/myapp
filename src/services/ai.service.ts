import { env } from "../lib/env.js";
import { sanitizeGeminiResponseSchema } from "../lib/gemini-schema.js";
import {
  finalizeMauriGeneratedReply,
  finalizeMauriTextReply,
  MAURI_ENGLISH_ONLY_LANGUAGE_RULE,
  MAURI_REPLY_MAX_WORDS,
  MAURI_REPLY_MAX_WORDS_EMOTIONAL,
  MAURI_REPLY_MAX_WORDS_MICRO_LESSON,
  MAURI_REPLY_MAX_WORDS_PROACTIVE,
  MAURI_REPLY_MAX_WORDS_ROAST_HYPE,
  MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT,
  MAURI_TEXT_REPLY_GUARDRAILS
} from "../lib/mauri-voice.js";
import {
  parseUserMindSnapshot,
  userMindExtractionJsonSchema,
  userMindExtractionSchema,
  userMindSnapshotJsonSchema,
  type UserMindExtraction,
  type UserMindSnapshotPayload
} from "../schemas/user-mind.js";
import { buildHelpFocusPromptForUser } from "./help-focus.service.js";
import { mauriBrainDumpJsonSchema, mauriBrainDumpSchema, parseStructuredJson } from "../schemas/extraction.js";
import {
  messageRouterExtractionJsonSchema,
  messageRouterExtractionSchema,
  type MessageRouterExtraction
} from "../schemas/message-router.js";
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
import { isCustomLaneArchetype } from "../types.js";
import { displayPrimaryLaneLabel } from "./brief-focus.service.js";
import type { UserMindReflectionInput } from "./user-mind-data.service.js";
import { buildReflectionPayloadSummary } from "./user-mind-prompt.js";

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
              ...(responseSchema
                ? { responseSchema: sanitizeGeminiResponseSchema(responseSchema) }
                : {})
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

export async function routeInboundMessage(input: {
  message: string;
  existingFactsSummary?: string | undefined;
  mode?: "chat" | "onboarding" | undefined;
}): Promise<MessageRouterExtraction> {
  const factsBlock = input.existingFactsSummary?.trim()
    ? `Known profile facts:\n${input.existingFactsSummary}`
    : "No profile facts loaded.";

  const onboardingRules =
    input.mode === "onboarding"
      ? `
ONBOARDING MODE — this is the user's first know-you message.
- intent must be "profile_delta".
- Extract generously: age, location, work, goals, stressors, relationships, interests, tone, boundaries.
- Emit many profile_deltas (up to 20) with user-voice fact_value phrases.
- Use categories: identity, location, life_context, interests, goals, stressors, relationships, preferences, boundaries.
- fact_key snake_case (preferred_name, area, work, wedding_loan, dad, side_hustle, etc.).
- Do not invent facts. Omit structured logs unless clearly present in the message.
`
      : "";

  const routingPrompt = `
You are Mauri's message router for a Mauritian lifestyle companion on WhatsApp.
Classify the inbound message and extract only what the user clearly stated.
${onboardingRules}
Rules:
- Return a single JSON object matching the schema.
- intent "chat_only" — vent, question, banter, no measurable log or profile change.
- intent "structured_log" — finance, habit, todo, or emotional mood/vent score.
- intent "profile_delta" — stable life fact changed (job, relationship, goal, stressor).
- intent "mixed" — both structured logs and profile deltas in one message.
- Do NOT emit intent "command" — explicit commands are handled elsewhere.
- Omit structured keys not clearly supported by the message.
- profile_deltas: category, fact_key (snake_case), fact_value (user voice, concise).
- todo_completions only when the user clearly marked a task done ("done X", "finished X").
- confidence "low" if ambiguous; prefer chat_only over guessing.
- Do not invent amounts, names, or facts.

${factsBlock}

Message:
${input.message}
`;

  const rawJson = await callGemini({
    prompt: routingPrompt,
    responseMimeType: "application/json",
    responseSchema: sanitizeGeminiResponseSchema(messageRouterExtractionJsonSchema)
  });
  const parsed = parseStructuredJson(rawJson);

  return messageRouterExtractionSchema.parse(parsed);
}

export async function extractUserMindProfile(message: string): Promise<UserMindExtraction> {
  const extractionPrompt = `
You are Mauri's person-profile parser for a Mauritian lifestyle companion on WhatsApp.
Extract every stable fact you can from the message — this profile powers how Mauri talks to them for months.

Rules:
- Do not invent facts that are not clearly supported.
- Omit fields that are absent.
- Capture generously when the user volunteers detail.
- Return only JSON.

Priority fields (extract when present or clearly inferable):
- age (integer) OR age_band (e.g. "early 20s", "mid-30s", "late 40s")
- preferred_name, area (Mauritius town/region), work, life_situation
- interests[], goals[], stressors[], tone_preference, boundaries[]
- relationships[{label, note}] — partner, kids, mum, co-founder, etc.

Age guidance:
- If they state a number ("I'm 26", "34 years old"), set age.
- If they give life stage without a number ("final year UoM", "new dad", "retired"), set age_band.
- Student / uni / exams without age → age_band "early 20s" only if clearly young adult context.
- Never guess a specific age without support.

Mauritius context:
- area = where they live or commute from (Rose Hill, Moka, Curepipe, etc.)
- life_situation can include family load, chomé, side hustle, night shifts, living with parents

Boundaries — capture explicit "don't" rules:
- guilt trips, long messages, money lectures, weekend work pings, etc.

Tone — how Mauri should show up: gentle, direct, short, banter ok, no fluff, etc.

Emotional / family context (critical — do not skip for work facts):
- Wife/partner illness, biopsy waiting, fertility on hold → relationships + stressors
- Parent ageing, sibling crisis, kids affected, gambling in family → relationships + stressors
- "So much going on", burnout, things on hold → stressors[] and richer life_situation
- Prefer several specific stressors over one vague line

Voice for stressors, goals, and relationship notes:
- Write in the user's voice — short plain phrases (under 12 words), not therapist/clinical labels.
- Good: "Dad expects me to cover brother's car loans", "Mum guilt-trips when I say no", "Wedding costs in Bel Ombre blowing up"
- Bad: "Emotional manipulation from mother", "Experiencing significant financial strain and emotional pressure"

Message:
${message}
`;

  const rawJson = await callGemini({
    prompt: extractionPrompt,
    responseMimeType: "application/json",
    responseSchema: userMindExtractionJsonSchema
  });
  const parsed = parseStructuredJson(rawJson);

  return userMindExtractionSchema.parse(parsed);
}

export async function generateKnowYouAcknowledgement(input: {
  firstName: string;
  message: string;
  factsSummary: string;
}): Promise<string> {
  const prompt = `You are Mauri on WhatsApp — a grounded mate for Mauritians, not a CRM bot.

The user just shared personal context during onboarding. Write a warm acknowledgement.

Rules:
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- Sound like a sharp friend who listened — not a therapist, not a CRM recap.
- Mirror 2–3 key threads max (who's involved, what's heavy). Do NOT repeat their whole message back sentence by sentence.
- Banned openers/phrases: "It sounds incredibly", "must be truly draining", "I hear you saying", "Just let me know if I've understood".
- Then ONE short sentence on work/area if relevant — prose only, never "35 yrs · Tamarin · Developer" bullet dumps.
- Do NOT add a correction invite — the app appends that separately.
- Max 90 words. Max 2 short paragraphs.
- No bullet lists. No middle dots. No "pick a lane" or archetype menu.
- Do not invent facts not in their message or extracted facts below.
- ONLY mention people, health issues, family events, and stressors that appear in What they wrote or Extracted facts. Never reference names or storylines from prior sessions or examples.

User: ${input.firstName}

What they wrote:
${input.message}

Extracted facts (ground your reply here):
${input.factsSummary}

Reply in plain text only.`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({
    reply: rawReply,
    maxWords: 90
  });
}

export async function generateExpressSetupQuestionReply(input: {
  firstName: string;
  message: string;
  factsSummary: string;
  setupLine: string;
  rationale: string;
}): Promise<string> {
  const prompt = `You are Mauri on WhatsApp — a grounded mate for Mauritians, mid-onboarding.

The user asked about the setup Mauri proposed before starting their trial. Answer like a human — not a settings menu.

Rules:
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- Answer their actual question first (how/why you chose this).
- Tie each part of the setup to specific things THEY shared — morning pulse, tools, tags.
- Plain prose only. No bullet lists. No "Corporate / Career" jargon — say commute, money, side hustle, etc.
- Be honest if something is a sensible default they can change (update topics / my modules).
- Max ${MAURI_REPLY_MAX_WORDS} words. Max 2 short paragraphs.
- End by inviting correction OR starting when it feels right — not pushy.

User: ${input.firstName}

Their question:
${input.message}

Proposed setup:
${input.setupLine}

Why each piece (ground truth — do not invent beyond this):
${input.rationale}

Extracted facts:
${input.factsSummary}

Reply in plain text only.`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({
    reply: rawReply,
    maxWords: MAURI_REPLY_MAX_WORDS
  });
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
- Mauri must always reply in English only — never Creole or French.
- personality_notes should capture communication style, stress triggers, and what tone lands (direct, gentle, humour, etc.).
- advice_preferences: how Mauri should coach this person (e.g. empathise first, then one concrete move).
- things_to_avoid: reply patterns that would feel wrong for this user (preachy, generic, ignoring money stress, etc.).
- active_goals, recent_wins, open_loops: short phrase items only.
- open_loops should include unresolved life threads from user_mind_facts (health waits, family care, stressors) when still relevant.
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

export async function generateProactiveCheckInMessage(input: {
  user: MauriUser;
  mode: "care" | "useful" | "curious";
  hookSummary: string;
  userMind?: UserMindSnapshotPayload | null;
}): Promise<string> {
  const modeGuidance = {
    care: "They have been quieter. Check in emotionally — grounded, not clingy. Reference the hook without guilt.",
    useful: "Offer one practical, data-backed nudge tied to the hook. No lecture.",
    curious: "Ask exactly one get-to-know question that helps you understand them better as a mate."
  }[input.mode];

  const mindBlock = input.userMind
    ? `User mind summary: ${input.userMind.life_summary}
Advice preferences: ${input.userMind.advice_preferences}
Things to avoid: ${input.userMind.things_to_avoid.join("; ")}`
    : "User mind: not built yet — keep it light.";

  const prompt = `You are Mauri in a private WhatsApp thread for Mauritians.
You are sending a proactive check-in (mode: ${input.mode}).

${modeGuidance}

Rules:
- 2 short paragraphs max.
- Warm, specific, never survey-like.
- One question max.
- Mention they can reply "not now" to pause proactive pings.
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- Sound like a real mate, not a bot.

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}
Hook: ${input.hookSummary}
${mindBlock}

Reply in plain text only.`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_PROACTIVE });
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
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- Sound like a real mate checking in.

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}
Open loop: ${input.loopText}

Reply in plain text only.`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_PROACTIVE });
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
${MAURI_TEXT_REPLY_GUARDRAILS}

User profile:
First name: ${user.first_name ?? "Unknown"}
Primary lane (7am brief): ${user.brief_focus?.trim() && isCustomLaneArchetype(user.archetype) ? displayPrimaryLaneLabel(user) : user.archetype}
${user.brief_focus?.trim() && isCustomLaneArchetype(user.archetype) ? `Brief focus: ${user.brief_focus.trim()}\n` : ""}Active modules: ${user.active_modules.length > 0 ? user.active_modules.join(", ") : "none"}
Subscription status: ${user.subscription_status}

Who this person is (what they told you — stable profile):
${context.userMindPrompt}

Advice lens (help focus — how to prioritize guidance):
${buildHelpFocusPromptForUser(user)}

What you've learned from their week (nightly reflection — if available):
${context.userMindSnapshotPrompt ?? "Not built yet — rely on facts and recent logs."}

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
Never reference details that are not in their profile facts, snapshot, or recent logs. Do not invent work hours, family members, or struggles they did not mention.
`;

  const rawReply = await callGemini({
    prompt: replyPrompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriTextReply({ message, reply: rawReply });
}

export async function generateTierOneDeepenReply(input: {
  firstName?: string | null;
  message: string;
  facts: import("../types.js").UserMindFact[];
}): Promise<string> {
  const name = input.firstName?.trim() || "there";
  const factLines = input.facts
    .slice(0, 12)
    .map((fact) => `- ${fact.category}: ${fact.fact_key} — ${fact.fact_value}`)
    .join("\n");

  const prompt = `
You are Mauri in a private WhatsApp thread.

Voice rules:
${MAURI_TEXT_REPLY_GUARDRAILS}

The user just sent a brief thank-you or relief message after sharing something heavy earlier:
"${input.message}"

Known facts (ONLY cite from this list — never invent):
${factLines || "No stored facts yet."}

Write ONE short reply that:
1. Acknowledges their thanks warmly (one sentence).
2. Asks ONE gentle follow-up question tied to a fact above — what's still heaviest or what's live for them.
3. Makes clear they can ignore it ("one word is fine" or similar).

Hard limit: ${MAURI_REPLY_MAX_WORDS} words. Plain text only. No lists.
`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, message: input.message });
}

export async function generateWeeklyDiagnosticCopy(input: {
  user: MauriUser;
  summary: WeeklyDiagnosticSummary;
  userMindPrompt?: string | undefined;
  narrativePrompt?: string | undefined;
}): Promise<string> {
  const { user, summary } = input;
  const userMindPrompt = input.userMindPrompt ?? "No explicit person profile yet.";
  const narrativePrompt = input.narrativePrompt?.trim() || "No reflection snapshot or open loops loaded.";

  const prompt = `
You are Mauri.
You are writing a Sunday diagnostic report for a user inside a private WhatsApp thread.

Voice rules:
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- No bullet lists.
- No numbered lists.
- No robotic headings.
- Short paragraphs.
- Sharp, warm, grounded.
- Sound real and emotionally intelligent.
- Hard limit: ${MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT} words. Max 3 short paragraphs.

User:
First name: ${user.first_name ?? "Unknown"}
Archetype: ${user.archetype}
Subscription status: ${user.subscription_status}

Who this person is:
${userMindPrompt}

Living reflection (snapshot, open loops, weekly focus — use especially when logs are quiet):
${narrativePrompt}

Weekly summary:
${JSON.stringify(summary)}

Write a compact weekly diagnostic.
Reflect what moved, what slipped, and what pattern is quietly shaping their week.
If logs are empty but profile/snapshot show live stress or goals, name that story — do not call it a blank week.
If momentum is decent, say it clean.
If the week was messy, be honest without being harsh.
If trial_cliffhanger is true, end with a subtle but irresistible cliffhanger that hints deeper tracking gets locked after trial unless they unlock premium.

Reply in plain text only.
`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT });
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
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
- Make clear replying is optional.

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}

Why we're asking (internal): ${input.prompt.reason ? reasonNotes[input.prompt.reason] : "quality pulse"}
${feedbackVariantGuidance(input.prompt)}

Weekly momentum: ${input.summary.momentum_score}/100

Reply in plain text only — the From Mauri section only.
`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_PROACTIVE });
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
      ? "Playfully sharp, honest peer energy. No cruelty. No bullet lists."
      : "Warm, hype them up, celebrate real wins only. No fake positivity. No bullet lists.";

  const prompt = `
You are Mauri in a private WhatsApp thread for Mauritians.
Mode: ${input.mode}
${tone}
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}
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

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_ROAST_HYPE });
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
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}

User archetype: ${input.user.archetype}
Weekly focus: ${input.weeklyFocus ?? "general balance"}

Reply in plain text only.
`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_MICRO_LESSON });
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
${MAURI_ENGLISH_ONLY_LANGUAGE_RULE}

User:
First name: ${input.user.first_name ?? "there"}
Archetype: ${input.user.archetype}
Weekly focus: ${input.weeklyFocus ?? "not set"}
Memory source: ${input.memorySource}
Memory: ${input.memoryText}

Reply in plain text only.
`;

  const rawReply = await callGemini({
    prompt,
    responseMimeType: "text/plain"
  });

  return finalizeMauriGeneratedReply({ reply: rawReply, maxWords: MAURI_REPLY_MAX_WORDS_PROACTIVE });
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
- advice_text: 1-2 short sentences telling a parent or commuter what to do right now. English only — no Creole or French. No bullet lists.

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
