import { describe, expect, it } from "vitest";

import {
  MAURITIUS_WEATHER_FALLBACK_LINE,
  appendWeatherGoOutTip,
  buildIslandWeatherLine,
  buildPersonalizedWeatherLine,
  buildWeatherGoOutTip,
  buildZoneWeatherLine,
  describeWmoWeatherCode,
  parseMauritiusWeatherSummary,
  resolveZoneIdFromArea,
  type MauritiusWeatherSummary,
  type MauritiusWeatherZoneSnapshot
} from "../src/services/mauritius-weather.service.js";

function zoneSnapshot(input: {
  id: MauritiusWeatherZoneSnapshot["id"];
  label: string;
  temp: number;
  condition: string;
  rainChance?: number;
  tempMin?: number;
  tempMax?: number;
}): MauritiusWeatherZoneSnapshot {
  return {
    id: input.id,
    label: input.label,
    current: {
      temperature_c: input.temp,
      weather_code: 0,
      condition: input.condition,
      precipitation_mm: 0,
      wind_kmh: 12
    },
    today: {
      temp_min_c: input.tempMin ?? input.temp - 2,
      temp_max_c: input.tempMax ?? input.temp + 4,
      precip_probability_max: input.rainChance ?? 10,
      precip_sum_mm: 0,
      weather_code: 0,
      condition: input.condition
    }
  };
}

function summaryFromZones(zones: MauritiusWeatherZoneSnapshot[]): MauritiusWeatherSummary {
  return {
    provider: "open-meteo",
    attribution: "Weather data by Open-Meteo.com",
    fetched_at: "2026-06-22T03:00:00.000Z",
    island_line: buildIslandWeatherLine(zones),
    zones
  };
}

describe("mauritius weather zones", () => {
  it("maps common WMO codes to readable conditions", () => {
    expect(describeWmoWeatherCode(0)).toBe("clear");
    expect(describeWmoWeatherCode(3)).toBe("partly cloudy");
    expect(describeWmoWeatherCode(61)).toBe("rain");
    expect(describeWmoWeatherCode(95)).toBe("thunderstorms");
  });

  it("resolves user areas to weather zones", () => {
    expect(resolveZoneIdFromArea("Vacoas")).toBe("central");
    expect(resolveZoneIdFromArea("Grand Baie")).toBe("north");
    expect(resolveZoneIdFromArea("Port Louis")).toBe("west");
    expect(resolveZoneIdFromArea("Mahebourg")).toBe("south");
    expect(resolveZoneIdFromArea("Belle Mare")).toBe("east");
    expect(resolveZoneIdFromArea("Tokyo")).toBeNull();
  });

  it("builds an island-wide line when coast and plateau differ", () => {
    const line = buildIslandWeatherLine([
      zoneSnapshot({ id: "central", label: "Central Plateau", temp: 18, condition: "drizzle", rainChance: 55 }),
      zoneSnapshot({ id: "north", label: "North / Grand Baie", temp: 22, condition: "partly cloudy", rainChance: 15 })
    ]);

    expect(line).toContain("Cooler inland");
    expect(line).toContain("18°C");
    expect(line).toContain("22°C");
  });

  it("builds a zone-specific line with rain chance", () => {
    const line = buildZoneWeatherLine(
      zoneSnapshot({
        id: "central",
        label: "Central Plateau",
        temp: 18,
        condition: "drizzle",
        rainChance: 52,
        tempMin: 17,
        tempMax: 23
      })
    );

    expect(line).toContain("Central Plateau");
    expect(line).toContain("52%");
    expect(line).toContain("high 23°C");
  });

  it("personalizes weather for a known user area", () => {
    const summary = summaryFromZones([
      zoneSnapshot({ id: "central", label: "Central Plateau", temp: 18, condition: "drizzle", rainChance: 45 }),
      zoneSnapshot({ id: "north", label: "North / Grand Baie", temp: 22, condition: "partly cloudy", rainChance: 12 }),
      zoneSnapshot({ id: "west", label: "West / Port Louis", temp: 21, condition: "partly cloudy", rainChance: 20 })
    ]);

    const line = buildPersonalizedWeatherLine(summary, "Vacoas");
    expect(line).toContain("Central Plateau");
    expect(line).toContain("18°C");
    expect(line).toContain("45%");
    expect(line).toContain("umbrella");
    expect(line).not.toContain("Cooler inland");
  });

  it("adds proactive go-out tips for high rain and heat", () => {
    const rainy = zoneSnapshot({
      id: "central",
      label: "Central Plateau",
      temp: 19,
      condition: "partly cloudy",
      rainChance: 92,
      tempMin: 18,
      tempMax: 24
    });

    expect(buildWeatherGoOutTip(rainy)).toContain("umbrella");
    expect(
      buildPersonalizedWeatherLine(summaryFromZones([rainy]), "Vacoas")
    ).toContain("grab an umbrella if you're heading out");

    const hot = zoneSnapshot({
      id: "north",
      label: "North / Grand Baie",
      temp: 29,
      condition: "clear",
      rainChance: 5,
      tempMin: 24,
      tempMax: 31
    });

    expect(buildWeatherGoOutTip(hot)).toContain("water and shade");
    expect(appendWeatherGoOutTip("North: 29°C, clear", hot)).toContain("water and shade");
  });

  it("falls back when weather data is missing", () => {
    expect(buildPersonalizedWeatherLine(null, "Vacoas")).toBe(MAURITIUS_WEATHER_FALLBACK_LINE);
  });

  it("parses stored weather snapshots", () => {
    const summary = summaryFromZones([
      zoneSnapshot({ id: "west", label: "West / Port Louis", temp: 21, condition: "clear" })
    ]);

    const parsed = parseMauritiusWeatherSummary(summary);
    expect(parsed?.zones).toHaveLength(1);
    expect(parsed?.island_line).toContain("21°C");
  });
});
