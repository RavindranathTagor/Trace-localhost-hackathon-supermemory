import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Redirect the ledger to a temp file so the test does not touch the repo's data/.
process.env.TRACE_LEDGER_PATH = join(tmpdir(), `trace-wiring-${process.pid}.json`);

// In-memory Supermemory: add appends, search returns everything at a fixed on-topic score.
vi.mock("@/lib/sm", () => {
  const store: Array<{ id: string; content: string; metadata: Record<string, unknown> | undefined }> = [];
  let n = 0;
  return {
    add: vi.fn(async (input: { content: string; metadata?: Record<string, unknown> }) => {
      const id = `sm${++n}`;
      store.push({ id, content: input.content, metadata: input.metadata });
      return { id, status: "queued" };
    }),
    search: vi.fn(async () => ({
      results: store.map((d) => ({ id: d.id, memory: d.content, similarity: 0.7, metadata: d.metadata ?? null })),
      total: store.length,
    })),
    hitText: (h: { memory?: string; chunk?: string }) => (h.memory ?? h.chunk ?? "").trim(),
    updateMetadata: vi.fn(async () => ({ id: "x", status: "done" })),
    health: vi.fn(async () => true),
  };
});

// Force the two model tiers to have no opinion, so the test is deterministic and offline.
vi.mock("@/lib/nli", () => ({ nli: async () => null }));
vi.mock("@/lib/judge", () => ({ judge: async () => null, judgeAvailable: () => false }));

// Imported after the mocks are registered.
let addPOST: (req: Request) => Promise<Response>;
let searchPOST: (req: Request) => Promise<Response>;
let ledger: typeof import("@/lib/ledger");

beforeAll(async () => {
  addPOST = (await import("@/app/api/v3/documents/route")).POST as unknown as typeof addPOST;
  searchPOST = (await import("@/app/api/v4/search/route")).POST as unknown as typeof searchPOST;
  ledger = await import("@/lib/ledger");
});

function post(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("route wiring: write-guard -> resolver -> current-truth read", () => {
  it("stores the first memory with no conflict", async () => {
    const res = await addPOST(post("http://t/api/v3/documents", { content: "We standardized on Postgres." }));
    const j = await res.json();
    expect(j.trace).toBeNull();
    expect(j.id).toBeTruthy();
  });

  it("detects drift on the reversing memory and supersedes the prior", async () => {
    const res = await addPOST(post("http://t/api/v3/documents", { content: "Migrating billing to MongoDB." }));
    const j = await res.json();
    expect(j.trace?.relation).toBe("drift");
    expect(j.trace?.prior).toContain("Postgres");
    // the ledger marks the Postgres decision superseded
    expect(ledger.supersededKeys().has(ledger.memKey("We standardized on Postgres."))).toBe(true);
  });

  it("returns only current truth on search, excluding the superseded memory", async () => {
    const res = await searchPOST(post("http://t/api/v4/search", { q: "database" }));
    const j = await res.json();
    const texts = j.results.map((r: { memory?: string }) => r.memory);
    expect(texts).toContain("Migrating billing to MongoDB.");
    expect(texts).not.toContain("We standardized on Postgres.");
    expect(j.excludedSuperseded).toBeGreaterThanOrEqual(1);
  });
});
