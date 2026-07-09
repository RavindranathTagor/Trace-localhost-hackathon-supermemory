// The current-truth resolver.
//
// Given the winning relation for an incoming memory, record it in the local ledger (the
// authoritative integrity state) and best-effort reflect supersession into Supermemory
// metadata so native search filters work too. The ledger is authoritative if the metadata
// write no-ops, so resolution never depends on Supermemory's update semantics.

import { memKey, record, type LedgerEvent } from "@/lib/ledger";
import { updateMetadata, type Metadata } from "@/lib/sm";
import type { Alignment } from "@/lib/car";

function slug(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "general"
  );
}

/** A stable topic key for grouping the belief timeline: the shared choice if there is
 *  one, else the first few words of the prior. */
export function topicOf(a: Alignment): string {
  return slug(a.priorChoice || a.newChoice || a.prior.split(/\s+/).slice(0, 4).join(" "));
}

export interface ResolveInput {
  nextText: string;
  nextMemId?: string;
  top: Alignment;
  ts: string; // ISO timestamp, stamped by the caller
}

export async function resolve(input: ResolveInput): Promise<LedgerEvent> {
  const { nextText, top, ts, nextMemId } = input;
  const nextKey = memKey(nextText);
  const priorKey = memKey(top.prior);
  const topic = topicOf(top);

  const event: LedgerEvent = {
    id: `${nextKey}-${priorKey}-${top.relation}`,
    ts,
    relation: top.relation,
    tier: top.tier,
    confidence: top.confidence,
    reason: top.reason,
    topic,
    next: { key: nextKey, text: nextText, memId: nextMemId },
    prior: { key: priorKey, text: top.prior, memId: top.priorId },
  };
  record(event);

  // Best-effort: reflect a drift's supersession into Supermemory metadata. If update
  // re-extracts or the prior was not written through Trace, this no-ops harmlessly.
  if (top.relation === "drift") {
    const meta: Metadata = {
      trace_status: "superseded",
      trace_superseded_by: nextKey,
      trace_topic: topic,
      trace_detected_at: ts,
    };
    void updateMetadata(priorKey, top.prior, meta).catch(() => {});
  }
  return event;
}

/** Flat trace_* metadata to stamp on the incoming memory as it is added. */
export function traceMetadata(top: Alignment | null, ts: string): Metadata {
  if (!top || top.relation === "none") return {};
  const topic = topicOf(top);
  const base: Metadata = {
    trace_relation: top.relation,
    trace_topic: topic,
    trace_detected_at: ts,
    trace_tier: top.tier,
  };
  if (top.relation === "drift") {
    return { ...base, trace_status: "current", trace_supersedes: memKey(top.prior) };
  }
  if (top.relation === "duplicate") {
    // The redo is the redundant one; the original remains current.
    return { ...base, trace_status: "superseded", trace_duplicate_of: memKey(top.prior) };
  }
  return { ...base, trace_status: "current" }; // reaffirm
}
