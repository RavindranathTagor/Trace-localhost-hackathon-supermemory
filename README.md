<div align="center">

# Trace

### A contradiction-free memory for your coding agent.

Trace sits in front of [Supermemory Local](https://supermemory.ai/docs/self-hosting/overview)
and catches the moment your memory contradicts itself. It resolves conflicts to a single
**current truth**, shows the full lineage of every belief, and keeps your `CLAUDE.md`
clean, 100% offline on `localhost`.

Built for the **Localhost:6767** Supermemory Local hackathon.

</div>

---

## The problem

Supermemory says it handles contradictions and expires stale facts. Under the hood that
is recency-based supersession. Trace makes it **deep, auditable, and age-blind**: when a
new decision reverses an old one, Trace catches it the moment it is written, marks the
loser superseded (with dates and evidence), and returns only the standing truth on read,
so your coding agent never reintroduces something you already ruled out.

## How it works

Trace is a thin layer over Supermemory Local. It never re-implements storage, embeddings,
or search:

- **Write guard** on `POST /v3/documents`: every new memory is checked against related
  priors before it lands.
- **Detection cascade**, all on-device: (0) Supermemory's own hybrid-search `similarity`
  is the topic gate; (1) a zero-LLM decision-grammar classifier labels the pair
  `drift | duplicate | reaffirm | none`; (2) a local NLI cross-encoder catches free-form
  prose the grammar misses; (3) a local Ollama model confirms borderline cases and phrases
  the rationale.
- **Current-truth read** on `POST /v4/search`: superseded memories are filtered out and a
  one-line "why" is attached.
- **Coding-agent surfaces**: a live `CLAUDE.md` / `AGENTS.md` generator and an MCP server
  (`check_before_coding`, `remember`, `current_truth`) your agent calls before it writes code.

See [docs/RUN-LOCAL.md](docs/RUN-LOCAL.md) for the Docker + Ollama setup on Windows.

## Use it

```bash
# 1. Supermemory Local up on :6767 (Docker on Windows, see docs/RUN-LOCAL.md):
docker compose up --build      # first boot prints your sm_... key
cp .env.example .env.local     # set SUPERMEMORY_API_KEY=sm_xxx
npm install
npm run dev                    # Trace on http://localhost:7070

# 2. Watch the guard fire (seeds a small decision history):
npm run seed

# 3. Open the dashboard: http://localhost:7070
#    Grab the live CLAUDE.md:  curl "http://localhost:7070/api/brain?format=md"
```

**Wire it into Claude Code** (or any MCP client) with the included [.mcp.json](.mcp.json):
`check_before_coding`, `remember`, and `current_truth` become tools your agent can call. The
MCP server ([adapters/mcp.mjs](adapters/mcp.mjs)) talks to the running Trace app, so detection
stays local.

Demo script: [docs/DEMO.md](docs/DEMO.md).

## API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/v3/documents` | Guarded write: detect + resolve, then store in Supermemory |
| `POST /api/v4/search` | Current-truth read: superseded memories filtered out, with a rationale |
| `POST /api/guard` | Dry-run: check an intent against memory without storing |
| `GET  /api/brain` | Live `CLAUDE.md` / `AGENTS.md` (`?format=md&target=claude`) |
| `GET  /api/events` | SSE stream of detected relations (powers the dashboard) |
| `GET  /api/health` | Liveness + whether Supermemory Local is reachable |

## Status

Built during the hackathon window. Foundation, the three-tier detection cascade
(grammar + NLI + judge), the current-truth resolver, the live dashboard, the CLAUDE.md
generator, and the MCP server are in and unit-tested (`npm test`). The detection engine has
full offline unit coverage; the end-to-end loop runs against the local Supermemory binary.

## A note on fresh work

Built fresh for Localhost:6767. The contradiction-aware-retrieval concept builds on my
earlier memory-integrity work, but all code in this repo is new and written against
Supermemory Local during the build window. The commit history reflects that.

## Tech

Next.js 14 (App Router, TypeScript strict) · Tailwind (OKLCH tokens) · Supermemory Local
(memory backend) · Ollama (local model) · transformers.js (local NLI) · Model Context
Protocol (agent interop) · Vitest.
