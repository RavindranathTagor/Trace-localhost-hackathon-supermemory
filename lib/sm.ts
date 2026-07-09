// Client for Supermemory Local (`supermemory-server`, http://localhost:6767).
//
// Trace never re-implements storage, embeddings, or extraction: Supermemory IS the
// memory backend. This client wraps the two endpoints Trace rides on:
//   - POST /v3/documents  add a memory  (returns { id, status })
//   - POST /v4/search     hybrid search (returns results with a similarity score)
// plus the read/update helpers the resolver and dashboard need. Shapes are taken
// from the public API docs (v3 documents, v4 search); the local binary serves the
// same contract as the hosted API, only the baseURL differs.

import { config } from "@/lib/config";

const BASE = config.sm.baseUrl;
const AUTH = { Authorization: `Bearer ${config.sm.apiKey}` };

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** Flat metadata only: Supermemory rejects nested objects/arrays. */
export type Metadata = Record<string, string | number | boolean>;

export interface AddInput {
  content: string;
  customId?: string;
  containerTag?: string;
  metadata?: Metadata;
  /** "instant" processes immediately (searchable fast); "dynamic" batches. */
  dreaming?: "instant" | "dynamic";
}

export interface AddResult {
  id: string;
  status: "queued" | "processing" | "done" | string;
}

export interface SearchFilterLeaf {
  key: string;
  value: string | number | boolean;
  negate?: boolean;
}
export interface SearchFilter {
  AND?: Array<SearchFilterLeaf | SearchFilter>;
  OR?: Array<SearchFilterLeaf | SearchFilter>;
}

export interface SearchOpts {
  containerTag?: string;
  searchMode?: "hybrid" | "memories";
  threshold?: number;
  limit?: number;
  filters?: SearchFilter;
  rerank?: boolean;
}

export interface SearchHit {
  id: string;
  /** Present depending on source; we read whichever is set as the hit's text. */
  memory?: string;
  chunk?: string;
  similarity: number;
  metadata: Metadata | null;
  updatedAt?: string;
  version?: number;
}

export interface SearchResponse {
  results: SearchHit[];
  total: number;
  timing?: number;
}

export interface DocumentStatus {
  id: string;
  status: "queued" | "processing" | "done" | string;
  metadata?: Metadata | null;
}

// ---------------------------------------------------------------------------
// low-level request
// ---------------------------------------------------------------------------

async function req<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...AUTH,
        ...(init.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`supermemory ${path} failed: ${res.status} ${body.slice(0, 300)}`);
    }
    // Some endpoints (e.g. a 204) may have no body.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// operations
// ---------------------------------------------------------------------------

/** Reachability probe: any HTTP response means the server is up. */
export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/v3/documents`, {
      method: "GET",
      headers: AUTH,
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    // 200/401/404 all prove the process is listening; only a network error is "down".
    return res.status > 0;
  } catch {
    return false;
  }
}

/** Add a memory. Detection runs on raw content upstream, so we default to instant
 *  processing here to keep priors searchable during a live session. */
export async function add(input: AddInput): Promise<AddResult> {
  const body: Record<string, unknown> = {
    content: input.content,
    containerTag: input.containerTag ?? config.sm.containerTag,
    dreaming: input.dreaming ?? "instant",
  };
  if (input.customId) body.customId = input.customId;
  if (input.metadata) body.metadata = input.metadata;
  return req<AddResult>("/v3/documents", { method: "POST", body: JSON.stringify(body) });
}

/** Hybrid search. The `similarity` on each hit is Trace's topic gate, so we do not
 *  run a second embedding stack. */
export async function search(q: string, opts: SearchOpts = {}): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    q,
    containerTag: opts.containerTag ?? config.sm.containerTag,
    searchMode: opts.searchMode ?? "hybrid",
    threshold: opts.threshold ?? 0.5,
    limit: opts.limit ?? 10,
  };
  if (opts.filters) body.filters = opts.filters;
  if (opts.rerank) body.rerank = true;
  const raw = await req<Partial<SearchResponse> & { results?: SearchHit[] }>("/v4/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    results: Array.isArray(raw.results) ? raw.results : [],
    total: typeof raw.total === "number" ? raw.total : raw.results?.length ?? 0,
    timing: raw.timing,
  };
}

/** The text of a hit, whichever field carries it. */
export function hitText(h: SearchHit): string {
  return (h.memory ?? h.chunk ?? "").trim();
}

/** Poll one document's processing status (for the dashboard freshness dot). */
export async function getDocument(id: string): Promise<DocumentStatus> {
  return req<DocumentStatus>(`/v3/documents/${encodeURIComponent(id)}`, { method: "GET" }, 12_000);
}

/** Update a document's metadata by re-adding under the same customId (upsert).
 *  customId is documented as "enabling updates & deduplication", so this is how the
 *  resolver flips trace_status without spinning up a second store. Day-2 check:
 *  confirm this does not re-run heavy extraction; if it does, the local ledger in
 *  lib/ledger.ts becomes the source of truth and the search wrapper post-filters. */
export async function updateMetadata(
  customId: string,
  content: string,
  metadata: Metadata,
): Promise<AddResult> {
  return add({ customId, content, metadata, dreaming: "dynamic" });
}
