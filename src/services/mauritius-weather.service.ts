import { logger } from "../lib/logger.js";
import { MAURITIUS_WEATHER_ZONES, type MauritiusWeatherZoneDefinition } from "./morning-brief.constants.js";

export type MauritiusWeatherZoneId = (typeof MAURITIUS_WEATHER_ZONES)[number]["id"];

export interface MauritiusWeatherZoneSnapshot {
  id: MauritiusWeatherZoneId;
  label: string;
  current: {
    temperature_c: number;
    weather_code: number;
    condition: string;
    precipitation_mm: number;
    wind_kmh: number;
  };
  today: {
    temp_min_c: number;
    temp_max_c: number;
    precip_probability_max: number;
    precip_sum_mm: number;
    weather_code: number;
    condition: string;
  };
}

export interface MauritiusWeatherSummary {
  provider: "open-meteo";
  attribution: "Weather data by Open-Meteo.com";
  fetched_at: string;
  island_line: string;
  zones: MauritiusWeatherZoneSnapshot[];
}

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export const MAURITIUS_WEATHER_FALLBACK_LINE =
  "Mauritius morning check — forecast unavailable right now; dress for warm days and cooler evenings inland.";

function roundTemperature(value: number): number {
  return Math.round(value);
}

export function describeWmoWeatherCode(code: number): string {
  if (code === 0) return "clear";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 55) return "drizzle";
  if (code <= 65) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "showers";
  if (code <= 86) return "snow showers";
  if (code === 95) return "thunderstorms";
  if (code <= 99) return "thunderstorms with hail";
  return "mixed conditions";
}

function isRainyCondition(condition: string): boolean {
  return /drizzle|rain|shower|thunder/i.test(condition);
}

function formatTemperature(value: number): string {
  return `${roundTemperature(value)}°C`;
}

function formatZoneShortLine(zone: MauritiusWeatherZoneSnapshot): string {
  const temp = formatTemperature(zone.current.temperature_c);
  const condition = zone.current.condition;
  const rainChance = zone.today.precip_probability_max;

  if (rainChance >= 50) {
    return `${zone.label}: ${temp}, ${condition} — up to ${rainChance}% rain chance today`;
  }

  if (rainChance >= 30) {
    return `${zone.label}: ${temp}, ${condition} — light rain possible (${rainChance}%)`;
  }

  return `${zone.label}: ${temp}, ${condition}`;
}

export function buildZoneWeatherLine(zone: MauritiusWeatherZoneSnapshot): string {
  const highLow = `high ${formatTemperature(zone.today.temp_max_c)}, low ${formatTemperature(zone.today.temp_min_c)}`;
  const base = formatZoneShortLine(zone);

  if (zone.today.precip_sum_mm >= 2) {
    return `${base}; ${highLow}, wetter day expected.`;
  }

  return `${base}; ${highLow}.`;
}

export function buildIslandWeatherLine(zones: MauritiusWeatherZoneSnapshot[]): string {
  if (zones.length === 0) {
    return MAURITIUS_WEATHER_FALLBACK_LINE;
  }

  const temps = zones.map((zone) => zone.current.temperature_c);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const rainyZones = zones.filter(
    (zone) => isRainyCondition(zone.current.condition) || zone.today.precip_probability_max >= 40
  );
  const coolest = zones.reduce((best, zone) =>
    zone.current.temperature_c < best.current.temperature_c ? zone : best
  );
  const warmest = zones.reduce((best, zone) =>
    zone.current.temperature_c > best.current.temperature_c ? zone : best
  );

  if (rainyZones.length >= 2) {
    const names = rainyZones.map((zone) => zone.label.split(" / ")[0]).join(", ");
    return `Showery across parts of Mauritius (${names}) — around ${formatTemperature(minTemp)} to ${formatTemperature(maxTemp)}.`;
  }

  if (maxTemp - minTemp >= 3) {
    return `Cooler inland (${formatTemperature(coolest.current.temperature_c)} in ${coolest.label.split(" / ")[0]}) and warmer on the coast (${formatTemperature(warmest.current.temperature_c)} in ${warmest.label.split(" / ")[0]}).`;
  }

  const avgTemp = roundTemperature(temps.reduce((sum, temp) => sum + temp, 0) / temps.length);
  const dominantCondition = zones[0]?.current.condition ?? "mixed conditions";
  const maxRainChance = Math.max(...zones.map((zone) => zone.today.precip_probability_max));

  if (maxRainChance >= 40) {
    return `Mauritius around ${avgTemp}°C, ${dominantCondition} — rain possible in spots (up to ${maxRainChance}%).`;
  }

  return `Mauritius around ${avgTemp}°C, ${dominantCondition} island-wide.`;
}

export function resolveZoneIdFromArea(area: string | null | undefined): MauritiusWeatherZoneId | null {
  const normalized = area?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const zone of MAURITIUS_WEATHER_ZONES) {
    if (zone.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
      return zone.id;
    }
  }

  return null;
}

export function buildPersonalizedWeatherLine(
  summary: MauritiusWeatherSummary | null,
  area: string | null | undefined
): string {
  if (!summary || summary.zones.length === 0) {
    return MAURITIUS_WEATHER_FALLBACK_LINE;
  }

  const zoneId = resolveZoneIdFromArea(area);
  if (!zoneId) {
    return summary.island_line;
  }

  const userZone = summary.zones.find((zone) => zone.id === zoneId);
  if (!userZone) {
    return summary.island_line;
  }

  const localLine = formatZoneShortLine(userZone);
  const islandLine = summary.island_line;

  if (islandLine.toLowerCase().includes(userZone.label.split(" / ")[0]!.toLowerCase())) {
    return `${localLine}.`;
  }

  return `${localLine}. ${islandLine}`;
}

function parseOpenMeteoZone(
  zone: MauritiusWeatherZoneDefinition,
  payload: Record<string, unknown>
): MauritiusWeatherZoneSnapshot | null {
  const current = payload.current as Record<string, unknown> | undefined;
  const daily = payload.daily as Record<string, unknown> | undefined;

  if (!current || !daily) {
    return null;
  }

  const currentCode = Number(current.weather_code);
  const dailyCode = Number((daily.weather_code as number[] | undefined)?.[0]);
  const currentTemp = Number(current.temperature_2m);
  const tempMax = Number((daily.temperature_2m_max as number[] | undefined)?.[0]);
  const tempMin = Number((daily.temperature_2m_min as number[] | undefined)?.[0]);

  if (!Number.isFinite(currentTemp) || !Number.isFinite(tempMax) || !Number.isFinite(tempMin)) {
    return null;
  }

  return {
    id: zone.id,
    label: zone.label,
    current: {
      temperature_c: currentTemp,
      weather_code: Number.isFinite(currentCode) ? currentCode : 0,
      condition: describeWmoWeatherCode(Number.isFinite(currentCode) ? currentCode : 0),
      precipitation_mm: Number(current.precipitation ?? 0),
      wind_kmh: Number(current.wind_speed_10m ?? 0)
    },
    today: {
      temp_min_c: tempMin,
      temp_max_c: tempMax,
      precip_probability_max: Number((daily.precipitation_probability_max as number[] | undefined)?.[0] ?? 0),
      precip_sum_mm: Number((daily.precipitation_sum as number[] | undefined)?.[0] ?? 0),
      weather_code: Number.isFinite(dailyCode) ? dailyCode : currentCode,
      condition: describeWmoWeatherCode(Number.isFinite(dailyCode) ? dailyCode : currentCode)
    }
  };
}

async function fetchZoneForecast(
  zone: MauritiusWeatherZoneDefinition,
  timezone: string
): Promise<MauritiusWeatherZoneSnapshot | null> {
  const params = new URLSearchParams({
    latitude: String(zone.latitude),
    longitude: String(zone.longitude),
    current: "temperature_2m,weather_code,precipitation,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    timezone,
    forecast_days: "1"
  });

  const response = await fetch(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return parseOpenMeteoZone(zone, payload);
}

export async function fetchMauritiusWeatherSummary(timezone: string): Promise<MauritiusWeatherSummary | null> {
  try {
    const zoneResults = await Promise.all(
      MAURITIUS_WEATHER_ZONES.map((zone) => fetchZoneForecast(zone, timezone))
    );
    const zones = zoneResults.filter((zone): zone is MauritiusWeatherZoneSnapshot => zone !== null);

    if (zones.length === 0) {
      return null;
    }

    return {
      provider: "open-meteo",
      attribution: "Weather data by Open-Meteo.com",
      fetched_at: new Date().toISOString(),
      island_line: buildIslandWeatherLine(zones),
      zones
    };
  } catch (error) {
    logger.warn({ error }, "Mauritius weather fetch failed.");
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMauritiusWeatherSummary(raw: unknown): MauritiusWeatherSummary | null {
  if (!isRecord(raw) || raw.provider !== "open-meteo" || !Array.isArray(raw.zones)) {
    return null;
  }

  const zones = raw.zones
    .map((zone) => {
      if (!isRecord(zone) || !isRecord(zone.current) || !isRecord(zone.today)) {
        return null;
      }

      const id = String(zone.id ?? "");
      const definition = MAURITIUS_WEATHER_ZONES.find((entry) => entry.id === id);
      if (!definition) {
        return null;
      }

      return {
        id: definition.id,
        label: String(zone.label ?? definition.label),
        current: {
          temperature_c: Number(zone.current.temperature_c),
          weather_code: Number(zone.current.weather_code),
          condition: String(zone.current.condition ?? describeWmoWeatherCode(Number(zone.current.weather_code))),
          precipitation_mm: Number(zone.current.precipitation_mm ?? 0),
          wind_kmh: Number(zone.current.wind_kmh ?? 0)
        },
        today: {
          temp_min_c: Number(zone.today.temp_min_c),
          temp_max_c: Number(zone.today.temp_max_c),
          precip_probability_max: Number(zone.today.precip_probability_max ?? 0),
          precip_sum_mm: Number(zone.today.precip_sum_mm ?? 0),
          weather_code: Number(zone.today.weather_code),
          condition: String(zone.today.condition ?? describeWmoWeatherCode(Number(zone.today.weather_code)))
        }
      } satisfies MauritiusWeatherZoneSnapshot;
    })
    .filter((zone): zone is MauritiusWeatherZoneSnapshot => zone !== null);

  if (zones.length === 0) {
    return null;
  }

  return {
    provider: "open-meteo",
    attribution: "Weather data by Open-Meteo.com",
    fetched_at: String(raw.fetched_at ?? new Date().toISOString()),
    island_line: String(raw.island_line ?? buildIslandWeatherLine(zones)),
    zones
  };
}
