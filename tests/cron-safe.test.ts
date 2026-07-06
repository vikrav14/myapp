import { describe, expect, it, vi } from "vitest";

import { runCronJobSafely } from "../src/lib/cron-safe.js";

describe("runCronJobSafely", () => {
  it("logs and swallows job failures", async () => {
    const job = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(runCronJobSafely("test_job", job)).resolves.toBeUndefined();
    expect(job).toHaveBeenCalledOnce();
  });
});
