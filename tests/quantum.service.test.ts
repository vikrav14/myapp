import { describe, expect, it } from "vitest";

import { mapByteToRange, mapBytesToRange } from "../src/services/quantum.service.js";

describe("quantum range mapping", () => {
  it("maps unbiased bytes into a small range", () => {
    expect(mapByteToRange(0, 1, 5)).toBe(1);
    expect(mapByteToRange(51, 1, 5)).toBe(2);
    expect(mapByteToRange(255, 1, 5)).toBeNull();
  });

  it("uses the first unbiased byte from a batch", () => {
    expect(mapBytesToRange([255, 51, 9], 1, 5)).toBe(2);
  });
});
