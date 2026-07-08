import type { Request, Response } from "express";

import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { buildReportWebHtml } from "../services/report-web.service.js";
import { verifySundayCardToken } from "../services/rich-media.service.js";
import { mapUser } from "../services/user.service.js";
import type { WeeklyDiagnosticSummary } from "../types.js";

export async function handleReportWebRequest(request: Request, response: Response): Promise<void> {
  const rawToken = request.params.token;
  const token = typeof rawToken === "string" ? rawToken : "";
  const verified = verifySundayCardToken(token);

  if (!verified) {
    response.status(404).send("Not found.");
    return;
  }

  const [userResult, reportResult] = await Promise.all([
    supabase.from("users").select("*").eq("id", verified.userId).maybeSingle(),
    supabase
      .from("weekly_reports")
      .select("report_text, summary_json")
      .eq("user_id", verified.userId)
      .eq("week_start", verified.weekStart)
      .maybeSingle()
  ]);

  if (userResult.error || reportResult.error) {
    logger.warn(
      { userError: userResult.error, reportError: reportResult.error, userId: verified.userId },
      "Failed to load weekly report web page."
    );
    response.status(500).send("Failed to load report.");
    return;
  }

  if (!userResult.data || !reportResult.data) {
    response.status(404).send("Not found.");
    return;
  }

  const summary = reportResult.data.summary_json;
  if (!summary || typeof summary !== "object") {
    response.status(404).send("Not found.");
    return;
  }

  const user = mapUser(userResult.data as Record<string, unknown>);
  const html = buildReportWebHtml({
    firstName: user.first_name,
    reportText: String(reportResult.data.report_text),
    summary: summary as WeeklyDiagnosticSummary,
    weeklyFocus: user.weekly_focus_habit
  });

  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "private, max-age=300");
  response.status(200).send(html);
}
