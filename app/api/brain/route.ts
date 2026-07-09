import { NextRequest, NextResponse } from "next/server";
import { events, supersededKeys } from "@/lib/ledger";
import { buildBrain, renderRules, memoriesFromEvents } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/brain?format=md|json&target=claude|agents
//
// The Company Brain / rules-file endpoint. A coding agent (or `npm run` script) pulls the
// current-truth memory as a ready-to-drop CLAUDE.md / AGENTS.md, so every agent shares one
// contradiction-free context. Derived from the local ledger, so it is instant and offline.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "md").toLowerCase();
  const target = (url.searchParams.get("target") || "claude").toLowerCase() as "claude" | "agents" | "md";

  const evs = events();
  const brain = buildBrain(memoriesFromEvents(evs), evs, supersededKeys());

  if (format === "json") {
    return NextResponse.json(brain);
  }
  const body = renderRules(brain, target === "agents" ? "agents" : target === "md" ? "md" : "claude");
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
