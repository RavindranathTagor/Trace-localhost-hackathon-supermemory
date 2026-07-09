import { NextRequest, NextResponse } from "next/server";
import { add, search, hitText, type AddInput, type Metadata } from "@/lib/sm";
import { config } from "@/lib/config";
import { detect } from "@/lib/detect";
import { memKey } from "@/lib/ledger";
import { resolve, traceMetadata } from "@/lib/resolve";
import type { Prior } from "@/lib/car";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v3/documents — the guarded write path.
//
// Before a memory lands, Trace searches Supermemory for related priors (their hybrid
// -search similarity is the topic gate), runs the detection cascade on the RAW content
// (so it is instant and never waits on the async extraction pipeline), stamps trace_*
// metadata, adds the memory, then resolves any conflict to a single current truth. Trace
// IS the write path, so it learns of the change instantly and needs no webhook.
export async function POST(req: NextRequest) {
  let body: AddInput;
  try {
    body = (await req.json()) as AddInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const customId = body.customId ?? memKey(content);
  const containerTag = body.containerTag ?? config.sm.containerTag;

  // 1) Fetch related priors (fail-soft: no priors -> just a plain add).
  let priors: Prior[] = [];
  try {
    const found = await search(content, {
      containerTag,
      threshold: config.detect.topicGate,
      limit: 8,
    });
    priors = found.results
      .map((h) => ({ text: hitText(h), similarity: h.similarity, id: h.id }))
      .filter((p) => p.text && memKey(p.text) !== customId);
  } catch (err) {
    console.error("[guard] prior search failed, adding without a check:", err instanceof Error ? err.message : err);
  }

  // 2) Run the cascade.
  const verdict = priors.length ? await detect(content, priors) : { alerts: [], signals: [], top: null };
  const ts = new Date().toISOString();

  // 3) Add, stamped with the verdict's trace_* metadata.
  const metadata: Metadata = { ...(body.metadata as Metadata | undefined), ...traceMetadata(verdict.top, ts) };
  let added;
  try {
    added = await add({ content, customId, containerTag, metadata, dreaming: body.dreaming ?? "instant" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 4) Resolve: record the ledger event (+ best-effort supersede metadata).
  if (verdict.top) {
    await resolve({ nextText: content, nextMemId: added.id, top: verdict.top, ts });
  }

  return NextResponse.json({
    ...added,
    trace: verdict.top
      ? {
          relation: verdict.top.relation,
          confidence: Number(verdict.top.confidence.toFixed(2)),
          tier: verdict.top.tier,
          reason: verdict.top.reason,
          prior: verdict.top.prior,
          priorId: verdict.top.priorId,
        }
      : null,
  });
}
