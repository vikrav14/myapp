import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/env.js", () => ({
  env: {
    GOOGLE_MAPS_API_KEY: "test-key"
  }
}));

import {
  buildCommuteCorridorLabel,
  extractWorkPlace,
  fetchTrafficCorridor,
  normalizeMauritiusPlace
} from "../src/services/mauritius-traffic.service.js";

describe("mauritius traffic helpers", () => {
  it("normalizes place names for Distance Matrix", () => {
    expect(normalizeMauritiusPlace("Vacoas")).toBe("Vacoas, Mauritius");
    expect(normalizeMauritiusPlace("Grand Baie, Mauritius")).toBe("Grand Baie, Mauritius");
  });

  it("extracts work place from freeform work facts", () => {
    expect(extractWorkPlace("Office in Port Louis")).toBe("Port Louis");
    expect(extractWorkPlace("Ebene Cybercity")).toBe("Ebene Cybercity");
  });

  it("builds a commute corridor label", () => {
    expect(buildCommuteCorridorLabel("Vacoas", "Port Louis")).toBe("Vacoas to Port Louis");
  });

  it("fetches a live custom corridor from Distance Matrix", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            elements: [
              {
                status: "OK",
                duration_in_traffic: { text: "39 mins", value: 2340 }
              }
            ]
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const corridor = await fetchTrafficCorridor({
      origin: "Vacoas",
      destination: "Grand Baie"
    });

    expect(corridor?.duration_text).toBe("39 mins");
    expect(corridor?.label).toBe("Vacoas to Grand Baie");
    expect(fetchMock).toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
