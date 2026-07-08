import { env } from "../lib/env.js";
import type { WeeklyDiagnosticSummary } from "../types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    day: "numeric",
    month: "short"
  });

  return `${formatter.format(new Date(weekStart))} – ${formatter.format(new Date(weekEnd))}`;
}

function formatReportBody(reportText: string): string {
  return escapeHtml(reportText.trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br />");
}

export function buildReportWebHtml(input: {
  firstName?: string | null;
  reportText: string;
  summary: WeeklyDiagnosticSummary;
  weeklyFocus?: string | null;
}): string {
  const name = input.firstName?.trim() || "You";
  const weekLabel = formatWeekLabel(input.summary.window.week_start, input.summary.window.week_end);
  const momentum = input.summary.momentum_score;
  const spend =
    input.summary.finance.entry_count > 0
      ? `Rs ${Math.round(input.summary.finance.total_spent)}`
      : "—";
  const habits =
    input.summary.habits.total_logs > 0
      ? `${input.summary.habits.successful_logs}/${input.summary.habits.total_logs} wins`
      : "—";
  const todos =
    input.summary.todos.completed_count > 0 || input.summary.todos.open_count > 0
      ? `${input.summary.todos.completed_count} done · ${input.summary.todos.open_count} open`
      : "—";
  const mood =
    input.summary.emotions.average_anxiety !== null
      ? `${input.summary.emotions.average_anxiety}/5`
      : "—";
  const focus = escapeHtml(input.weeklyFocus?.trim() || "One small win each day");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)}'s week — Mauri</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --card: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #34d399;
      --bar: #334155;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
      color: var(--text);
      line-height: 1.5;
      padding: 20px 16px 40px;
    }
    .wrap { max-width: 520px; margin: 0 auto; }
    .eyebrow { color: var(--muted); font-size: 0.85rem; letter-spacing: 0.04em; text-transform: uppercase; }
    h1 { margin: 8px 0 4px; font-size: 1.75rem; }
    .week { color: var(--muted); margin-bottom: 24px; }
    .hero {
      background: var(--card);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 16px;
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .momentum-label { color: var(--muted); font-size: 0.9rem; }
    .momentum-value { font-size: 2.4rem; font-weight: 700; margin: 4px 0 12px; }
    .bar {
      height: 10px;
      border-radius: 999px;
      background: var(--bar);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      width: ${Math.max(0, Math.min(100, momentum))}%;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .tile {
      background: var(--card);
      border-radius: 16px;
      padding: 14px;
      border: 1px solid rgba(148, 163, 184, 0.1);
    }
    .tile-label { color: var(--muted); font-size: 0.8rem; margin-bottom: 6px; }
    .tile-value { font-size: 1.1rem; font-weight: 600; }
    .prose {
      background: var(--card);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 16px;
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .prose p { margin: 0 0 12px; }
    .prose p:last-child { margin-bottom: 0; }
    .focus {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 16px;
      padding: 14px 16px;
      margin-bottom: 16px;
    }
    .focus-label { color: var(--accent); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .cta {
      display: grid;
      gap: 10px;
    }
    .cta-card {
      background: var(--card);
      border-radius: 16px;
      padding: 16px;
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .cta-card strong { display: block; margin-bottom: 4px; }
    .cta-card span { color: var(--muted); font-size: 0.92rem; }
    footer {
      margin-top: 28px;
      color: var(--muted);
      font-size: 0.82rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">Sunday check-in</div>
    <h1>${escapeHtml(name)}'s week</h1>
    <div class="week">${escapeHtml(weekLabel)}</div>

    <section class="hero" aria-label="Momentum">
      <div class="momentum-label">Momentum</div>
      <div class="momentum-value">${momentum}<span style="font-size:1rem;color:var(--muted);font-weight:500;">/100</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${momentum}" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    </section>

    <section class="grid" aria-label="Weekly stats">
      <div class="tile"><div class="tile-label">Money logged</div><div class="tile-value">${escapeHtml(spend)}</div></div>
      <div class="tile"><div class="tile-label">Habits</div><div class="tile-value">${escapeHtml(habits)}</div></div>
      <div class="tile"><div class="tile-label">Tasks</div><div class="tile-value">${escapeHtml(todos)}</div></div>
      <div class="tile"><div class="tile-label">Mood avg</div><div class="tile-value">${escapeHtml(mood)}</div></div>
    </section>

    <section class="focus">
      <div class="focus-label">This week's focus</div>
      <div>${focus}</div>
    </section>

    <section class="prose" aria-label="Report">
      <p>${formatReportBody(input.reportText)}</p>
    </section>

    <section class="cta" aria-label="Next steps">
      <div class="cta-card">
        <strong>🔥 Want the roast?</strong>
        <span>Back in WhatsApp, reply <em>roast me</em> — same week, same numbers.</span>
      </div>
      <div class="cta-card">
        <strong>📣 Need a hype?</strong>
        <span>Reply <em>hype me</em> and Mauri will celebrate what actually moved.</span>
      </div>
    </section>

    <footer>Private link · Mauri 🦤</footer>
  </div>
</body>
</html>`;
}
