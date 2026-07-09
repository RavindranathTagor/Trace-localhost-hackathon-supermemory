import { NextRequest, NextResponse } from "next/server";
import { search, type SearchOpts } from "@/lib/sm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v4/search — the read path.
//
// Day 1: transparent passthrough to Supermemory Local's hybrid search. Day 3 turns
// this into the current-truth wrapper: it appends a metadata filter that excludes
// superseded memories ({ key: "trace_status", value: "superseded", negate: true })
// and attaches a one-line rationale, so a caller only ever sees the standing truth.
export async function POST(req: NextRequest) {
  let body: { q?: string } & SearchOpts;
  try {
    body = (await req.json()) as { q?: string } & SearchOpts;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.q || typeof body.q !== "string") {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const { q, ...opts } = body;
  try {
    const result = await search(q, opts);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
