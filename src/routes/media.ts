import type { Request, Response } from "express";

import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import {
  buildSundayCardSvg,
  buildWelcomeCardSvg,
  renderSvgToPng,
  verifySundayCardToken
} from "../services/rich-media.service.js";
import { mapUser } from "../services/user.service.js";

async function sendPng(response: Response, png: Buffer): Promise<void> {
  response.setHeader("content-type", "image/png");
  response.setHeader("cache-control", "public, max-age=300");
  response.status(200).send(png);
}

export async function handleWelcomeImageRequest(_request: Request, response: Response): Promise<void> {
  const png = await renderSvgToPng(buildWelcomeCardSvg());
  if (!png) {
    response.status(503).send("Rich media rendering unavailable.");
    return;
  }

  await sendPng(response, png);
}

export async function handleSundayCardImageRequest(request: Request, response: Response): Promise<void> {
  const rawToken = request.params.token;
  const token = typeof rawToken === "string" ? rawToken.replace(/\.png$/i, "") : "";
  const verified = verifySundayCardToken(token);

  if (!verified) {
    response.status(404).send("Not found.");
    return;
  }

  const { data, error } = await supabase.from("users").select("*").eq("id", verified.userId).maybeSingle();
  if (error) {
    logger.warn({ error, userId: verified.userId }, "Failed to load user for Sunday card image.");
    response.status(500).send("Failed to load card.");
    return;
  }

  if (!data) {
    response.status(404).send("Not found.");
    return;
  }

  const user = mapUser(data as Record<string, unknown>);
  const { data: reportData, error: reportError } = await supabase
    .from("weekly_reports")
    .select("summary_json")
    .eq("user_id", verified.userId)
    .eq("week_start", verified.weekStart)
    .maybeSingle();

  if (reportError) {
    logger.warn({ error: reportError, userId: verified.userId }, "Failed to load weekly report for Sunday card.");
    response.status(500).send("Failed to load card.");
    return;
  }

  const summary = reportData?.summary_json;
  if (!summary || typeof summary !== "object") {
    response.status(404).send("Not found.");
    return;
  }

  const png = await renderSvgToPng(
    buildSundayCardSvg({
      firstName: user.first_name,
      summary: summary as Parameters<typeof buildSundayCardSvg>[0]["summary"],
      weeklyFocus: user.weekly_focus_habit
    })
  );

  if (!png) {
    response.status(503).send("Rich media rendering unavailable.");
    return;
  }

  await sendPng(response, png);
}
