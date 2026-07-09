import { NextRequest, NextResponse } from "next/server";
import { add, type AddInput } from "@/lib/sm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v3/documents — the write path.
//
// Day 1: transparent passthrough to Supermemory Local's add. Day 2 inserts the
// write-time guard here: before forwarding, run the detection cascade against
// related priors, and on a confident drift/duplicate/reaffirm resolve to current
// truth. Because Trace IS the write path, it learns of every change instantly and
// needs no webhook (Supermemory has none).
export async function POST(req: NextRequest) {
  let body: AddInput;
  try {
    body = (await req.json()) as AddInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.content || typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  try {
    const result = await add(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
