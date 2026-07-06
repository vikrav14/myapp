import { describe, expect, it } from "vitest";

import { inferArchetypeFromMessage } from "../src/services/archetype-catalog.js";

describe("archetype catalog", () => {
  it("maps numeric replies to the documented 1–5 order", () => {
    expect(inferArchetypeFromMessage("1")).toBe("Corporate / Career");
    expect(inferArchetypeFromMessage("2")).toBe("Life & Habit Tracking");
    expect(inferArchetypeFromMessage("3")).toBe("Student Grind");
    expect(inferArchetypeFromMessage("4")).toBe("Entrepreneur Mode");
    expect(inferArchetypeFromMessage("5")).toBe("My Own Mix");
  });

  it("maps text aliases to archetypes", () => {
    expect(inferArchetypeFromMessage("corporate")).toBe("Corporate / Career");
    expect(inferArchetypeFromMessage("entrepreneur mode")).toBe("Entrepreneur Mode");
    expect(inferArchetypeFromMessage("my own mix")).toBe("My Own Mix");
  });
});
