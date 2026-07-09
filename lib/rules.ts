// The Company-Brain / rules-file generator.
//
// This is Trace's coding-agent surface: it turns the current-truth memory into a clean
// CLAUDE.md / AGENTS.md your agent reads before it writes code, so it never reintroduces
// something you already ruled out. "Current truth" = memories that are not superseded (per
// the ledger), plus a "past reversals, do NOT repeat" section derived from drift events,
// and the convictions you keep reaffirming. Pure formatting so it is unit-testable.

import type { LedgerEvent } from "@/lib/ledger";

export interface BrainMemory {
  key: string;
  text: string;
}

export interface Reversal {
  from: string; // the superseded decision
  to: string; // what replaced it
  when: string; // ISO date
}

export interface Brain {
  current: string[]; // standing decisions / constraints
  reversals: Reversal[]; // superseded -> current, do NOT repeat
  reaffirmed: Array<{ text: string; count: number }>; // convictions restated over time
}

/** Every memory the ledger has seen (deduped by key). Self-contained source for the brain
 *  so it works offline without a Supermemory list call; the interesting brain content is
 *  exactly the memories that took part in a relation. */
export function memoriesFromEvents(events: LedgerEvent[]): BrainMemory[] {
  const map = new Map<string, string>();
  for (const e of events) {
    map.set(e.next.key, e.next.text);
    if (e.prior) map.set(e.prior.key, e.prior.text);
  }
  return Array.from(map, ([key, text]) => ({ key, text }));
}

/** Build the brain from the full memory set and the ledger. Memories whose key is in the
 *  superseded set are dropped from `current`; drift events become reversals. */
export function buildBrain(
  memories: BrainMemory[],
  events: LedgerEvent[],
  superseded: Set<string>,
): Brain {
  const current = memories.filter((m) => !superseded.has(m.key)).map((m) => m.text.trim());

  const reversals: Reversal[] = events
    .filter((e) => e.relation === "drift" && e.prior)
    .map((e) => ({ from: e.prior!.text.trim(), to: e.next.text.trim(), when: e.ts.slice(0, 10) }));

  const counts = new Map<string, { text: string; count: number }>();
  for (const e of events) {
    if (e.relation === "reaffirm" && e.prior) {
      const c = counts.get(e.prior.key) ?? { text: e.prior.text.trim(), count: 0 };
      c.count += 1;
      counts.set(e.prior.key, c);
    }
  }
  const reaffirmed = Array.from(counts.values())
    .filter((r) => r.count >= 1)
    .sort((a, b) => b.count - a.count);

  return { current, reversals, reaffirmed };
}

const HEADER: Record<string, string> = {
  claude: "# CLAUDE.md — generated from your Trace memory. Do not edit by hand.",
  agents: "# AGENTS.md — generated from your Trace memory. Do not edit by hand.",
  md: "## Project memory (from Trace)",
};

/** Render the brain as a rules file for the given agent target. */
export function renderRules(brain: Brain, target: "claude" | "agents" | "md" = "claude"): string {
  const L: string[] = [
    HEADER[target] ?? HEADER.md,
    "",
    "> Consult this before writing code. It is your live, contradiction-free memory.",
    "",
  ];

  if (brain.current.length) {
    L.push("### Current decisions & constraints");
    for (const c of brain.current) L.push(`- ${c}`);
    L.push("");
  }

  if (brain.reversals.length) {
    L.push("### Past reversals — do NOT repeat");
    for (const r of brain.reversals) L.push(`- Was **${r.from}** → now **${r.to}** (${r.when}).`);
    L.push("");
  }

  if (brain.reaffirmed.length) {
    L.push("### Reaffirmed convictions (restated over time)");
    for (const r of brain.reaffirmed) L.push(`- ${r.text} _(restated ${r.count}×)_`);
    L.push("");
  }

  if (!brain.current.length && !brain.reversals.length) {
    L.push("_No memories yet. Add some through Trace and this file fills in._", "");
  }

  return L.join("\n");
}
