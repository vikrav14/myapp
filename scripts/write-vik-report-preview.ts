import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildVikSilentWeekPreview } from "../src/services/report-preview.fixture.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = join(root, "artifacts");
const outPath = join(artifactsDir, "vik-sunday-report-preview.html");

mkdirSync(artifactsDir, { recursive: true });
const { html } = buildVikSilentWeekPreview();
writeFileSync(outPath, html, "utf8");

console.log(`Wrote ${outPath}`);
