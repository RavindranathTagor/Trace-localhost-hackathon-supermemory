import { NextRequest, NextResponse } from "next/server";
import { search, hitText } from "@/lib/sm";
import { config } from "@/lib/config";
import { detect } from "@/lib/detect";
import { memKey } from "@/lib/ledger";
import type { Prior } from "@/lib/car";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/guard — a DRY-RUN check. Runs the detection cascade against memory WITHOUT
// storing anything. This backs the MCP `check_before_coding` tool: an agent asks "does my
// plan conflict with what we already decided?" and gets a verdict before it writes code.
export async function POST(req: NextRequest) {
  let body: { text?: string; intent?: string };
  try {
    body = (await req.json()) as { text?: string; intent?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const text = (body.text ?? body.intent ?? "").trim();
  if (!text) return NextResponse.json({ error: "text/intent is required" }, { status: 400 });

  let priors: Prior[] = [];
  try {
    const found = await search(text, { threshold: config.detect.topicGate, limit: 8 });
    priors = found.results
      .map((h) => ({ text: hitText(h), similarity: h.similarity, id: h.id }))
      .filter((p) => p.text && memKey(p.text) !== memKey(text));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  const verdict = priors.length ? await detect(text, priors) : { alerts: [], signals: [], top: null };
  return NextResponse.json({
    conflict: verdict.alerts.length > 0,
    top: verdict.top,
    alerts: verdict.alerts,
    signals: verdict.signals,
  });
}
