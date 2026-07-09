"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---- shapes mirrored from the server (lib/ledger, lib/rules) ----
interface MemoryRef {
  key: string;
  text: string;
  memId?: string;
}
interface RelationEvent {
  id: string;
  ts: string;
  relation: "drift" | "duplicate" | "reaffirm" | "none";
  tier: "grammar" | "nli" | "judge";
  confidence: number;
  reason: string;
  topic: string;
  next: MemoryRef;
  prior?: MemoryRef;
}
interface Brain {
  current: string[];
  reversals: Array<{ from: string; to: string; when: string }>;
  reaffirmed: Array<{ text: string; count: number }>;
}
interface AddResponse {
  id?: string;
  status?: string;
  error?: string;
  trace?: {
    relation: "drift" | "duplicate" | "reaffirm" | "none";
    confidence: number;
    tier: string;
    reason: string;
    prior?: string;
  } | null;
}

const REL_COLOR: Record<string, string> = {
  drift: "text-drift border-drift",
  duplicate: "text-duplicate border-duplicate",
  reaffirm: "text-reaffirm border-reaffirm",
  none: "text-muted border-border",
};
const REL_LABEL: Record<string, string> = {
  drift: "DRIFT",
  duplicate: "DUPLICATE",
  reaffirm: "REAFFIRM",
  none: "no conflict",
};

export default function Dashboard() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<AddResponse | null>(null);
  const [feed, setFeed] = useState<RelationEvent[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [connected, setConnected] = useState(false);
  const [smReachable, setSmReachable] = useState<boolean | null>(null);
  const [online, setOnline] = useState(true);
  const seen = useRef<Set<string>>(new Set());

  const refreshBrain = useCallback(async () => {
    try {
      const r = await fetch("/api/brain?format=json", { cache: "no-store" });
      if (r.ok) setBrain((await r.json()) as Brain);
    } catch {
      /* ignore */
    }
  }, []);

  // Live SSE feed.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("relation", (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent).data) as RelationEvent;
        if (seen.current.has(e.id)) return;
        seen.current.add(e.id);
        setFeed((f) => [e, ...f].slice(0, 100));
      } catch {
        /* skip malformed */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    void refreshBrain();
  }, [refreshBrain, feed.length]);

  // Health poll.
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = await r.json();
        setSmReachable(Boolean(j?.supermemory?.reachable));
      } catch {
        setSmReachable(false);
      }
    };
    void tick();
    const id = setInterval(tick, 8000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const addMemory = useCallback(async () => {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setVerdict(null);
    try {
      const r = await fetch("/api/v3/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const j = (await r.json()) as AddResponse;
      setVerdict(j);
      setInput("");
      void refreshBrain();
    } catch (err) {
      setVerdict({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [input, busy, refreshBrain]);

  // Belief timeline: group events by topic, newest first.
  const timeline = useMemo(() => {
    const byTopic = new Map<string, RelationEvent[]>();
    for (const e of feed) {
      const arr = byTopic.get(e.topic) ?? [];
      arr.push(e);
      byTopic.set(e.topic, arr);
    }
    return Array.from(byTopic.entries());
  }, [feed]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Header connected={connected} smReachable={smReachable} online={online} />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: the write path + the hero verdict */}
        <section className="space-y-4">
          <div className="rounded-card border border-border bg-surface p-5">
            <label className="font-mono text-xs text-muted">add a memory (drives the guard)</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void addMemory();
              }}
              rows={3}
              placeholder='e.g. "We standardized on Postgres." then later "Migrating billing to MongoDB."'
              className="mt-2 w-full resize-none rounded-lg border border-border bg-bg p-3 font-mono text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-xs text-muted">⌘/Ctrl + Enter</span>
              <button
                onClick={() => void addMemory()}
                disabled={busy || !input.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "checking…" : "Remember"}
              </button>
            </div>
          </div>

          {verdict && <VerdictCard v={verdict} />}

          <Feed feed={feed} />
        </section>

        {/* Right: current truth + timeline */}
        <section className="space-y-4">
          <BrainCard brain={brain} />
          <Timeline timeline={timeline} />
        </section>
      </div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  const c = ok == null ? "bg-muted" : ok ? "bg-reaffirm" : "bg-drift";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} style={{ backgroundColor: "currentColor" }} />;
}

function Header({ connected, smReachable, online }: { connected: boolean; smReachable: boolean | null; online: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-mono text-sm text-accent">trace · localhost:7070</p>
        <h1 className="text-2xl font-semibold">Contradiction-free memory</h1>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs text-muted">
        <span className={smReachable ? "text-reaffirm" : "text-drift"}>
          ● supermemory {smReachable == null ? "…" : smReachable ? "up" : "down"}
        </span>
        <span className={connected ? "text-reaffirm" : "text-muted"}>● feed {connected ? "live" : "…"}</span>
        <span className={online ? "text-muted" : "text-reaffirm"}>● {online ? "online" : "OFFLINE — all local"}</span>
      </div>
    </header>
  );
}

function VerdictCard({ v }: { v: AddResponse }) {
  if (v.error) {
    return (
      <div className="rounded-card border border-drift bg-surface p-4 text-drift">
        <p className="font-mono text-sm">error: {v.error}</p>
      </div>
    );
  }
  const t = v.trace;
  if (!t || t.relation === "none") {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="font-mono text-sm text-muted">stored · no conflict with prior memory</p>
      </div>
    );
  }
  return (
    <div className={`rounded-card border-2 bg-surface p-4 ${REL_COLOR[t.relation]}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-bold tracking-wide">{REL_LABEL[t.relation]}</span>
        <span className="font-mono text-xs text-muted">
          {t.tier} · {Math.round(t.confidence * 100)}%
        </span>
      </div>
      <p className="mt-2 text-sm text-text">{t.reason}</p>
      {t.prior && <p className="mt-2 border-l-2 border-border pl-3 text-sm text-muted">prior: “{t.prior}”</p>}
    </div>
  );
}

function Feed({ feed }: { feed: RelationEvent[] }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <p className="font-mono text-xs text-muted">live feed</p>
      {feed.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No events yet. Add two memories that conflict.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {feed.map((e) => (
            <li key={e.id + e.ts} className="flex items-start gap-3 border-b border-border pb-2 last:border-0">
              <span className={`mt-0.5 font-mono text-xs font-bold ${REL_COLOR[e.relation].split(" ")[0]}`}>
                {REL_LABEL[e.relation]}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm">{e.next.text}</p>
                <p className="font-mono text-xs text-muted">
                  {e.reason} · {e.tier} · {Math.round(e.confidence * 100)}%
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrainCard({ brain }: { brain: Brain | null }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-muted">CLAUDE.md · current truth</p>
        <a href="/api/brain?format=md&target=claude" className="font-mono text-xs text-accent" target="_blank" rel="noreferrer">
          open →
        </a>
      </div>
      {!brain || (brain.current.length === 0 && brain.reversals.length === 0) ? (
        <p className="mt-3 text-sm text-muted">Empty. What you add flows in here, minus anything superseded.</p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          {brain.current.length > 0 && (
            <div>
              <p className="font-mono text-xs text-reaffirm">current decisions</p>
              <ul className="mt-1 list-disc pl-5 text-text">
                {brain.current.slice(0, 6).map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {brain.reversals.length > 0 && (
            <div>
              <p className="font-mono text-xs text-drift">reversals — do not repeat</p>
              <ul className="mt-1 space-y-1">
                {brain.reversals.slice(0, 5).map((r, i) => (
                  <li key={i} className="text-muted">
                    <span className="line-through">{r.from}</span> → <span className="text-text">{r.to}</span>{" "}
                    <span className="font-mono text-xs">({r.when})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Timeline({ timeline }: { timeline: Array<[string, RelationEvent[]]> }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <p className="font-mono text-xs text-muted">belief timeline</p>
      {timeline.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Topics appear here as memories relate to each other.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {timeline.map(([topic, evs]) => (
            <div key={topic}>
              <p className="font-mono text-xs text-accent">{topic}</p>
              <ul className="mt-1 space-y-1">
                {evs.map((e) => (
                  <li key={e.id + e.ts} className="text-sm">
                    <span className={`font-mono text-xs ${REL_COLOR[e.relation].split(" ")[0]}`}>
                      {REL_LABEL[e.relation]}
                    </span>{" "}
                    <span className="text-text">{e.next.text}</span>{" "}
                    <span className="font-mono text-xs text-muted">{e.ts.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
