import { randomInt } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export type QuantumRandomSource = "quantum" | "fallback";

export interface QuantumRandomIntResult {
  value: number;
  source: QuantumRandomSource;
}

interface AnuQuantumResponse {
  success?: boolean;
  data?: number[];
  message?: string;
}

export function mapByteToRange(byte: number, min: number, max: number): number | null {
  const rangeSize = max - min + 1;
  const threshold = Math.floor(256 / rangeSize) * rangeSize;

  if (byte >= threshold) {
    return null;
  }

  return min + (byte % rangeSize);
}

export function mapBytesToRange(bytes: number[], min: number, max: number): number | null {
  for (const byte of bytes) {
    const mapped = mapByteToRange(byte, min, max);
    if (mapped !== null) {
      return mapped;
    }
  }

  return null;
}

function getFallbackRandomInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}

async function fetchQuantumBytes(length: number): Promise<number[] | null> {
  if (!env.ANU_QUANTUM_API_KEY) {
    return null;
  }

  const url = new URL(env.ANU_QUANTUM_API_URL);
  url.searchParams.set("length", String(length));
  url.searchParams.set("type", "uint8");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.QUANTUM_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": env.ANU_QUANTUM_API_KEY
      },
      signal: controller.signal
    });

    if (!response.ok) {
      logger.warn(
        {
          statusCode: response.status
        },
        "ANU quantum numbers API returned a non-success status."
      );
      return null;
    }

    const payload = (await response.json()) as AnuQuantumResponse;
    if (!payload.success || !Array.isArray(payload.data) || payload.data.length === 0) {
      logger.warn(
        {
          message: payload.message
        },
        "ANU quantum numbers API returned an unsuccessful payload."
      );
      return null;
    }

    return payload.data.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 255);
  } catch (error) {
    logger.warn({ error }, "Failed to fetch quantum random numbers.");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getQuantumRandomInt(min: number, max: number): Promise<QuantumRandomIntResult> {
  if (!env.QUANTUM_PICK_ENABLED) {
    return {
      value: getFallbackRandomInt(min, max),
      source: "fallback"
    };
  }

  const bytes = await fetchQuantumBytes(8);
  const mapped = bytes ? mapBytesToRange(bytes, min, max) : null;

  if (mapped !== null) {
    return {
      value: mapped,
      source: "quantum"
    };
  }

  return {
    value: getFallbackRandomInt(min, max),
    source: "fallback"
  };
}

export function isQuantumPickConfigured(): boolean {
  return env.QUANTUM_PICK_ENABLED && Boolean(env.ANU_QUANTUM_API_KEY);
}
