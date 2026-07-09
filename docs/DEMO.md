# Demo script (<= 3 minutes)

Rehearse the exact click path 5+ times. Keep a backup recording. Use real data, a good
mic, and burned-in captions. Win it in the first 10 seconds.

## Setup before recording
1. WSL2: `supermemory-server` running on `:6767`, Ollama running with `qwen2.5:7b`.
2. Windows: `npm run dev` (Trace on `:7070`). Dashboard open at `http://localhost:7070`.
3. Header shows `supermemory up` and `feed live`.
4. Optional warm-up so priors exist: `npm run seed` (or type them live for drama).

## Beats

**0:00–0:10 — Cold open (no intro).** Dashboard already up. Type `We standardized on Postgres.`
→ Remember. Then type `Migrating billing to MongoDB.` → Remember. The verdict card slams in:
**DRIFT · CURRENT MongoDB · SUPERSEDED Postgres**, with the tier and confidence and the prior
quote. VO: "Watch my agent's memory catch itself changing its mind."

**0:10–0:25 — Problem, one line.** "Supermemory says it handles contradictions. Under the hood
that's recency. Trace makes it deep, auditable, and offline."

**0:25–0:40 — How, on Supermemory Local.** Show the terminal: `supermemory-server` on `:6767`,
Ollama as the model. "One baseURL change and Trace guards every write."

**0:40–2:00 — Golden path.**
- Run a search (or show the CLAUDE.md card): only the current truth (MongoDB) with a one-line "why".
- Point to the belief timeline: the Postgres → MongoDB pivot, dated, with which tier fired.
- Reaffirm: type the REST decision, then restate it — Trace shows it as a strengthening signal,
  not an alert (reaffirm counter goes up).
- Duplicate: type "building a retry queue for payments" — Trace flags it against the shared one.
- Claude Code: run `check_before_coding({intent:"use MongoDB for billing"})` via the MCP server →
  it returns the cited conflict. Show the regenerated `CLAUDE.md` (superseded decisions gone).

**2:00–2:20 — The local money shot.** Flip airplane mode / `wsl --shutdown` of extras. Repeat the
drift catch. "No network. Data lives only in `./.supermemory`."

**2:20–3:00 — Impact + ask.** "Memory isn't RAG. Trace tracks facts, resolves contradictions, and
shows its work, on your machine." Tagline + public repo link + tag `@supermemory @DhravyaShah`.
