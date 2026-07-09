import { env } from "./env.js";

export type GeminiHealthStatus = "ok" | "error";

export interface GeminiHealthReport {
  status: GeminiHealthStatus;
  model: string;
  latencyMs: number | null;
  message: string;
  httpStatus: number | null;
}

export async function probeGeminiHealth(): Promise<GeminiHealthReport> {
  const model = env.GEMINI_MODEL;
  const startedAt = Date.now();

  if (!env.GOOGLE_AI_API_KEY?.trim()) {
    return {
      status: "error",
      model,
      latencyMs: null,
      message: "GOOGLE_AI_API_KEY is not configured.",
      httpStatus: null
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: 'Reply with JSON only: {"ok":true}' }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" }
              },
              required: ["ok"]
            }
          }
        })
      }
    );

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        status: "error",
        model,
        latencyMs,
        message: truncateErrorMessage(errorText),
        httpStatus: response.status
      };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

    if (!text) {
      return {
        status: "error",
        model,
        latencyMs,
        message: "Gemini returned an empty response (possible safety block).",
        httpStatus: response.status
      };
    }

    return {
      status: "ok",
      model,
      latencyMs,
      message: "Gemini structured JSON generation succeeded.",
      httpStatus: response.status
    };
  } catch (error) {
    return {
      status: "error",
      model,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unknown Gemini probe error.",
      httpStatus: null
    };
  }
}

function truncateErrorMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 280) {
    return trimmed;
  }

  return `${trimmed.slice(0, 277)}...`;
}
