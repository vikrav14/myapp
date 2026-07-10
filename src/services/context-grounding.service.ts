import type { SemanticMemoryMatch, UserMindFact } from "../types.js";
import { combinedFactBlob } from "./profile-inference.service.js";

const HIGH_RISK_CONTAMINATION: Array<{ memoryPattern: RegExp; factPattern: RegExp }> = [
  { memoryPattern: /\bloan shark/i, factPattern: /\bloan shark|shark|threat/i },
  { memoryPattern: /\bcrypto\b/i, factPattern: /\bcrypto/i },
  { memoryPattern: /\belectricity bill/i, factPattern: /\belectricity|ceb|bill/i },
  { memoryPattern: /\bthreat(s|ened)?\b/i, factPattern: /\bthreat/i },
  { memoryPattern: /\bbiopsy\b/i, factPattern: /\bbiopsy/i },
  { memoryPattern: /\bfactory job\b/i, factPattern: /\bfactory/i },
  { memoryPattern: /\bjeshna\b/i, factPattern: /\bjeshna/i }
];

function normalizeForCompare(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterGroundedSemanticMemories(
  memories: SemanticMemoryMatch[],
  facts: UserMindFact[]
): SemanticMemoryMatch[] {
  const factBlob = combinedFactBlob(facts);

  return memories.filter((memory) => {
    const text = memory.text.trim();
    if (!text || text.length < 12) {
      return false;
    }

    if (/^morning mood check:/i.test(text)) {
      return false;
    }

    for (const rule of HIGH_RISK_CONTAMINATION) {
      if (rule.memoryPattern.test(text) && !rule.factPattern.test(factBlob)) {
        return false;
      }
    }

    return memory.similarity >= 0.62;
  });
}

export function stripInboundBotEcho(input: {
  message: string;
  recentAssistantBodies: string[];
}): string {
  let message = input.message.trim();
  if (!message) {
    return message;
  }

  message = message
    .replace(/^quick check\s*how's today feeling\?\s*private — never in your 7am news\s*/i, "")
    .replace(/^private — never in your 7am news\s*/i, "")
    .trim();

  for (const body of input.recentAssistantBodies) {
    const normalizedBody = normalizeForCompare(body);
    const normalizedMessage = normalizeForCompare(message);

    if (normalizedBody.length < 40) {
      continue;
    }

    if (normalizedMessage.startsWith(normalizedBody.slice(0, Math.min(normalizedBody.length, 120)))) {
      message = message.slice(body.length).trim();
    } else if (normalizedMessage.includes(normalizedBody.slice(0, 80))) {
      const index = normalizedMessage.indexOf(normalizedBody.slice(0, 80));
      message = message.slice(index + Math.min(body.length, 160)).trim();
    }
  }

  const questionTail = message.match(/(?:so what do you suggest|what do you suggest|what should i do|what now)\??\s*$/i);
  if (questionTail) {
    return questionTail[0].trim();
  }

  return message.trim();
}
