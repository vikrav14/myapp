import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface TrafficCorridorSnapshot {
  label: string;
  duration_text: string;
  duration_seconds: number | null;
  status: string;
}

export interface TrafficSnapshot {
  configured: boolean;
  corridors: TrafficCorridorSnapshot[];
  note?: string | undefined;
}

const TRAFFIC_UNAVAILABLE_PATTERN = /(unavailable|not available)/i;

export function normalizeMauritiusPlace(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  if (/\bmauritius\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}, Mauritius`;
}

export function extractWorkPlace(work: string): string {
  const cleaned = work.trim();
  const inMatch = cleaned.match(/\b(?:in|at|near|to)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'-]{2,})/i);
  if (inMatch?.[1]) {
    return inMatch[1].trim();
  }

  return cleaned;
}

export function buildCommuteCorridorLabel(home: string, work: string): string {
  return `${home} to ${work}`;
}

export function parseTrafficSnapshot(snapshot: Record<string, unknown> | null | undefined): TrafficSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const configured = Boolean(snapshot.configured);
  const corridorsRaw = snapshot.corridors;
  if (!Array.isArray(corridorsRaw)) {
    return {
      configured,
      corridors: [],
      ...(typeof snapshot.note === "string" ? { note: snapshot.note } : {})
    };
  }

  const corridors = corridorsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const row = entry as Record<string, unknown>;
      const label = String(row.label ?? "").trim();
      if (!label) {
        return null;
      }

      return {
        label,
        duration_text: String(row.duration_text ?? "unknown").trim(),
        duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
        status: String(row.status ?? "UNKNOWN")
      };
    })
    .filter((entry): entry is TrafficCorridorSnapshot => entry !== null);

  return {
    configured,
    corridors,
    ...(typeof snapshot.note === "string" ? { note: snapshot.note } : {})
  };
}

export function isTrafficCorridorLive(corridor: TrafficCorridorSnapshot | null | undefined): boolean {
  return Boolean(
    corridor &&
      corridor.status === "OK" &&
      corridor.duration_text !== "unknown" &&
      !TRAFFIC_UNAVAILABLE_PATTERN.test(corridor.duration_text)
  );
}

export async function fetchTrafficCorridor(input: {
  origin: string;
  destination: string;
  label?: string | undefined;
}): Promise<TrafficCorridorSnapshot | null> {
  if (!env.GOOGLE_MAPS_API_KEY?.trim()) {
    return null;
  }

  const origin = normalizeMauritiusPlace(input.origin);
  const destination = normalizeMauritiusPlace(input.destination);
  if (!origin || !destination) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      key: env.GOOGLE_MAPS_API_KEY,
      departure_time: "now",
      traffic_model: "best_guess"
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
    if (!response.ok) {
      return {
        label: input.label ?? buildCommuteCorridorLabel(input.origin, input.destination),
        status: "HTTP_ERROR",
        duration_text: "unknown",
        duration_seconds: null
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const element = (payload.rows as Array<{ elements?: Array<Record<string, unknown>> }> | undefined)?.[0]
      ?.elements?.[0];

    return {
      label: input.label ?? buildCommuteCorridorLabel(input.origin, input.destination),
      duration_text:
        (element?.duration_in_traffic as { text?: string } | undefined)?.text ??
        (element?.duration as { text?: string } | undefined)?.text ??
        "unknown",
      duration_seconds:
        (element?.duration_in_traffic as { value?: number } | undefined)?.value ??
        (element?.duration as { value?: number } | undefined)?.value ??
        null,
      status: String(element?.status ?? "UNKNOWN")
    };
  } catch (error) {
    logger.warn({ error, origin, destination }, "Custom commute corridor fetch failed.");
    return null;
  }
}

export async function fetchTrafficCorridors(
  corridors: Array<{ label: string; origin: string; destination: string }>
): Promise<TrafficCorridorSnapshot[]> {
  return Promise.all(
    corridors.map(async (corridor) => {
      const result = await fetchTrafficCorridor({
        origin: corridor.origin,
        destination: corridor.destination,
        label: corridor.label
      });

      return (
        result ?? {
          label: corridor.label,
          status: "FETCH_ERROR",
          duration_text: "unknown",
          duration_seconds: null
        }
      );
    })
  );
}
