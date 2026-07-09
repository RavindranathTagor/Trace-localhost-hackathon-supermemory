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

See [docs/RUN-LOCAL.md](docs/RUN-LOCAL.md) for the WSL2 + Ollama setup.

## Status

Under active development during the hackathon build window. Day 1 (foundation: proxy +
Supermemory Local client + health) is in; the detection engine, resolver, dashboard, and
MCP server follow.

## A note on fresh work

Built fresh for Localhost:6767. The contradiction-aware-retrieval concept builds on my
earlier memory-integrity work, but all code in this repo is new and written against
Supermemory Local during the build window. The commit history reflects that.

## Tech

Next.js 14 (App Router, TypeScript strict) · Tailwind (OKLCH tokens) · Supermemory Local
(memory backend) · Ollama (local model) · transformers.js (local NLI) · Model Context
Protocol (agent interop) · Vitest.
