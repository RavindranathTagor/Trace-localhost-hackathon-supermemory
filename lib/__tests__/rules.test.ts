import { describe, it, expect } from "vitest";
import { buildBrain, renderRules, type BrainMemory } from "@/lib/rules";
import type { LedgerEvent } from "@/lib/ledger";

const memories: BrainMemory[] = [
  { key: "m_pg", text: "We standardized on Postgres." },
  { key: "m_mongo", text: "Migrating billing to MongoDB." },
  { key: "m_rest", text: "Public API is REST with a typed SDK." },
];

const events: LedgerEvent[] = [
  {
    id: "e1", ts: "2026-07-10T09:00:00.000Z", relation: "drift", tier: "grammar",
    confidence: 0.9, reason: "reverses Postgres", topic: "postgres",
    next: { key: "m_mongo", text: "Migrating billing to MongoDB." },
    prior: { key: "m_pg", text: "We standardized on Postgres." },
  },
  {
    id: "e2", ts: "2026-07-10T10:00:00.000Z", relation: "reaffirm", tier: "grammar",
    confidence: 0.7, reason: "restates REST", topic: "rest",
    next: { key: "m_rest2", text: "Sticking with REST + SDK." },
    prior: { key: "m_rest", text: "Public API is REST with a typed SDK." },
  },
];

describe("buildBrain", () => {
  it("drops superseded memories from current truth and lists reversals", () => {
    const superseded = new Set(["m_pg"]); // Postgres lost to Mongo
    const brain = buildBrain(memories, events, superseded);
    expect(brain.current).not.toContain("We standardized on Postgres.");
    expect(brain.current).toContain("Migrating billing to MongoDB.");
    expect(brain.reversals[0]).toMatchObject({ from: "We standardized on Postgres.", to: "Migrating billing to MongoDB." });
    expect(brain.reaffirmed[0]).toMatchObject({ text: "Public API is REST with a typed SDK.", count: 1 });
  });
});

describe("renderRules", () => {
  it("emits a CLAUDE.md with current truth and a reversal section, no superseded decision", () => {
    const brain = buildBrain(memories, events, new Set(["m_pg"]));
    const md = renderRules(brain, "claude");
    expect(md).toContain("# CLAUDE.md");
    expect(md).toContain("### Current decisions & constraints");
    expect(md).toContain("### Past reversals — do NOT repeat");
    expect(md).toContain("Migrating billing to MongoDB.");
    // the superseded decision must not appear as a current constraint line
    expect(md).not.toMatch(/- We standardized on Postgres\.$/m);
  });
});
