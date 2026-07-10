import { NextRequest, NextResponse } from "next/server";
import { search, hitText, type SearchOpts } from "@/lib/sm";
import { memKey, supersededKeys, events } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v4/search — the current-truth read path.
//
// Runs Supermemory's hybrid search, then returns only the STANDING truth: memories the
// ledger marks superseded (drift losers, redundant duplicates) are filtered out, and a
// one-line rationale is attached to the winners. It also appends a best-effort metadata
// filter so a Supermemory that honors trace_status excludes superseded rows server-side.
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

  // Note: we deliberately do NOT push a Supermemory-side `trace_status != superseded`
  // filter here. A negated-equality metadata filter also excludes rows that have no
  // trace_status at all (i.e. every ordinary memory), which would hide everything. The
  // local ledger below is the authoritative, correct current-truth filter.
  let result;
  try {
    result = await search(q, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Authoritative client-side filter + rationale from the local ledger.
  const superseded = supersededKeys();
  const evs = events();
  const kept = [];
  let excluded = 0;
  for (const h of result.results) {
    const key = memKey(hitText(h));
    if (superseded.has(key)) {
      excluded++;
      continue;
    }
    const win = evs.find((e) => e.relation === "drift" && e.next.key === key);
    kept.push({
      ...h,
      why: win ? `current truth — superseded an earlier decision on "${win.topic}" (${win.ts.slice(0, 10)})` : undefined,
    });
  }

  return NextResponse.json({ results: kept, total: kept.length, excludedSuperseded: excluded, timing: result.timing });
}
