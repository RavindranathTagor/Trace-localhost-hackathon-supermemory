// Trace's local integrity ledger.
//
// The authoritative, on-device record of every relation Trace detects and the resulting
// current-truth state. It powers three things: the dashboard feed + belief timeline, the
// current-truth post-filter in the /v4 search wrapper, and the CLAUDE.md generator.
//
// Why a local ledger rather than only Supermemory metadata: it makes supersession work
// regardless of whether a document update re-triggers extraction, and it does not depend
// on every prior memory having a customId. Trace still writes trace_* metadata to
// Supermemory best-effort (so native filters work when they can), but the ledger is the
// source of truth. Kept on globalThis so all Next route bundles share one instance, with
// best-effort JSON persistence so it survives a restart.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Relation, DetectTier } from "@/lib/car";

// Read lazily so tests can redirect it via TRACE_LEDGER_PATH.
function ledgerPath(): string {
  return process.env.TRACE_LEDGER_PATH || join(process.cwd(), "data", "ledger.json");
}

export interface MemoryRef {
  /** Stable key derived from the memory text (customId-independent). */
  key: string;
  text: string;
  /** Supermemory document id / customId, when known. */
  memId?: string;
}

export interface LedgerEvent {
  id: string;
  ts: string; // ISO timestamp, stamped by the caller (no Date in pure logic)
  relation: Relation;
  tier: DetectTier;
  confidence: number;
  reason: string;
  topic: string;
  next: MemoryRef; // the incoming memory
  prior?: MemoryRef; // the memory it relates to
}

interface LedgerState {
  events: LedgerEvent[];
  superseded: Set<string>; // memory keys no longer current (drift losers)
  reaffirm: Map<string, number>; // memory key -> times restated
  listeners: Set<(e: LedgerEvent) => void>;
  loaded: boolean;
}

const state: LedgerState = ((globalThis as unknown as { __traceLedger?: LedgerState }).__traceLedger ??= {
  events: [],
  superseded: new Set(),
  reaffirm: new Map(),
  listeners: new Set(),
  loaded: false,
});

/** Stable, dependency-free key for a memory string (djb2 -> base36). */
export function memKey(text: string): string {
  let h = 5381;
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "m" + (h >>> 0).toString(36);
}

function load(): void {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(), "utf8")) as { events?: LedgerEvent[] };
    for (const e of raw.events ?? []) applyToDerived(e);
    state.events = raw.events ?? [];
  } catch {
    /* no ledger yet, start empty */
  }
}

function persist(): void {
  try {
    const p = ledgerPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ events: state.events }, null, 2));
  } catch {
    /* persistence is best-effort; the in-memory ledger still works */
  }
}

/** Re-derive the superseded set + reaffirm counts from one event. */
function applyToDerived(e: LedgerEvent): void {
  if (e.relation === "drift" && e.prior) state.superseded.add(e.prior.key);
  if (e.relation === "duplicate" && e.next) state.superseded.add(e.next.key); // the redo is redundant
  if (e.relation === "reaffirm" && e.prior) {
    state.reaffirm.set(e.prior.key, (state.reaffirm.get(e.prior.key) ?? 0) + 1);
  }
}

export function record(e: LedgerEvent): LedgerEvent {
  load();
  state.events.push(e);
  applyToDerived(e);
  persist();
  for (const fn of state.listeners) {
    try {
      fn(e);
    } catch {
      /* a broken listener must not break recording */
    }
  }
  return e;
}

export function events(): LedgerEvent[] {
  load();
  return state.events;
}

export function isSuperseded(key: string): boolean {
  load();
  return state.superseded.has(key);
}

export function supersededKeys(): Set<string> {
  load();
  return state.superseded;
}

export function reaffirmCount(key: string): number {
  load();
  return state.reaffirm.get(key) ?? 0;
}

/** Subscribe to new events (SSE feed). Returns an unsubscribe fn. */
export function subscribe(fn: (e: LedgerEvent) => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}
