import { env } from "../lib/env.js";
import type { WeeklyDailySeries, WeeklyDiagnosticSummary } from "../types.js";
import {
  formatWeekOverWeekLine,
  hasWeeklyReportCharts
} from "./report-daily-series.service.js";

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

function maxSeriesValue(values: Array<number | null>): number {
  const filtered = values.filter((value): value is number => value !== null);
  return filtered.length > 0 ? Math.max(...filtered) : 0;
}

function buildBarChartHtml(input: {
  title: string;
  series: Array<number | null>;
  labels: string[];
  valuePrefix?: string;
  accent?: string;
}): string {
  const maxValue = Math.max(maxSeriesValue(input.series), 1);
  const bars = input.series
    .map((value, index) => {
      const label = escapeHtml(input.labels[index] ?? "");
      if (value === null) {
        return `<div class="chart-col" aria-label="${label} no data">
  <div class="chart-bar ghost"></div>
  <div class="chart-label">${label}</div>
</div>`;
      }

      const height = Math.max(8, Math.round((value / maxValue) * 100));
      const display = input.valuePrefix ? `${input.valuePrefix}${value}` : String(value);

      return `<div class="chart-col" aria-label="${label} ${display}">
  <div class="chart-value">${escapeHtml(display)}</div>
  <div class="chart-bar" style="height:${height}%;background:${input.accent ?? "linear-gradient(180deg, #38bdf8, #34d399)"}"></div>
  <div class="chart-label">${label}</div>
</div>`;
    })
    .join("");

  return `<section class="chart-card" aria-label="${escapeHtml(input.title)}">
  <div class="chart-title">${escapeHtml(input.title)}</div>
  <div class="chart-grid">${bars}</div>
</section>`;
}

function buildDailyChartsHtml(daily: WeeklyDailySeries): string {
  const charts: string[] = [];
  const spendSignal = daily.spend_rs.filter((value) => value !== null).length;
  const habitSignal = daily.habit_wins.filter((value) => value !== null).length;

  if (spendSignal >= 2) {
    charts.push(
      buildBarChartHtml({
        title: "Spend by day",
        series: daily.spend_rs,
        labels: daily.labels,
        valuePrefix: "Rs ",
        accent: "linear-gradient(180deg, #f59e0b, #f97316)"
      })
    );
  }

  if (habitSignal >= 2) {
    charts.push(
      buildBarChartHtml({
        title: "Habit wins by day",
        series: daily.habit_wins,
        labels: daily.labels,
        accent: "linear-gradient(180deg, #38bdf8, #34d399)"
      })
    );
  }

  return charts.join("");
}

function buildWeekOverWeekHtml(summary: WeeklyDiagnosticSummary): string {
  const wow = summary.week_over_week;
  if (!wow) {
    return "";
  }

  const lines = [
    formatWeekOverWeekLine("Momentum", wow.momentum_delta, "momentum"),
    formatWeekOverWeekLine("Spend", wow.spend_delta_pct, "pct"),
    formatWeekOverWeekLine("Habit wins", wow.habit_wins_delta, "count")
  ].filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return `<section class="compare" aria-label="Week over week">
  <div class="compare-label">Vs last week</div>
  ${lines.map((line) => `<div class="compare-line">${escapeHtml(line ?? "")}</div>`).join("")}
</section>`;
}

function buildMemorySectionHtml(summary: WeeklyDiagnosticSummary): string {
  const memory = summary.memory;
  if (!memory?.active_focus && !memory?.strategy_track) {
    return "";
  }

  const lines: string[] = [];
  if (memory.active_focus) {
    lines.push(`<div><span class="memory-key">Active focus</span> ${escapeHtml(memory.active_focus)}</div>`);
  }
  if (memory.strategy_track) {
    lines.push(`<div><span class="memory-key">Strategy track</span> ${escapeHtml(memory.strategy_track)}</div>`);
  }
  if (memory.open_loops.length > 0) {
    lines.push(
      `<div><span class="memory-key">Open loops</span> ${escapeHtml(memory.open_loops.join("; "))}</div>`
    );
  }

  return `<section class="memory" aria-label="Mauri Memory">
  <div class="memory-label">🧠 Mauri Memory</div>
  ${lines.join("")}
</section>`;
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
  const memorySection = buildMemorySectionHtml(input.summary);
  const compareSection = buildWeekOverWeekHtml(input.summary);
  const chartsSection =
    input.summary.daily && hasWeeklyReportCharts(input.summary)
      ? buildDailyChartsHtml(input.summary.daily)
      : "";

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
    .hero, .memory, .compare, .chart-card, .tile, .prose, .focus, .cta-card {
      background: var(--card);
      border-radius: 20px;
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .hero {
      padding: 20px;
      margin-bottom: 16px;
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
    .compare {
      padding: 14px 16px;
      margin-bottom: 16px;
    }
    .compare-label, .memory-label, .chart-title {
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .compare-line { font-size: 0.95rem; margin-bottom: 4px; }
    .compare-line:last-child { margin-bottom: 0; }
    .memory {
      padding: 14px 16px;
      margin-bottom: 16px;
      background: rgba(56, 189, 248, 0.06);
      border-color: rgba(56, 189, 248, 0.18);
    }
    .memory-key {
      display: block;
      color: var(--accent);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    .memory > div + div { margin-top: 10px; }
    .chart-card {
      padding: 16px;
      margin-bottom: 16px;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 8px;
      align-items: end;
      min-height: 160px;
    }
    .chart-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: end;
      gap: 6px;
      min-height: 150px;
    }
    .chart-value {
      color: var(--muted);
      font-size: 0.62rem;
      min-height: 1.8em;
      text-align: center;
      line-height: 1.1;
    }
    .chart-bar {
      width: 100%;
      max-width: 28px;
      border-radius: 8px 8px 4px 4px;
      min-height: 8px;
    }
    .chart-bar.ghost {
      height: 8px;
      background: rgba(148, 163, 184, 0.18);
    }
    .chart-label {
      color: var(--muted);
      font-size: 0.72rem;
      text-align: center;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .tile { padding: 14px; border-color: rgba(148, 163, 184, 0.1); }
    .tile-label { color: var(--muted); font-size: 0.8rem; margin-bottom: 6px; }
    .tile-value { font-size: 1.1rem; font-weight: 600; }
    .prose { padding: 20px; margin-bottom: 16px; }
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
    .cta { display: grid; gap: 10px; }
    .cta-card { padding: 16px; }
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

    ${memorySection}

    <section class="hero" aria-label="Momentum">
      <div class="momentum-label">Momentum</div>
      <div class="momentum-value">${momentum}<span style="font-size:1rem;color:var(--muted);font-weight:500;">/100</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${momentum}" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    </section>

    ${compareSection}
    ${chartsSection}

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
