# Running Trace locally on Windows (Docker Desktop)

Supermemory Local ships only macOS and Linux binaries (no Windows build), so on Windows it
runs inside a Linux container via Docker Desktop. You never open an Ubuntu shell. Trace
itself runs natively on Windows and just talks to the container at `http://localhost:6767`.

Topology (all local, nothing leaves the machine):

```
Windows (native)                 Docker Desktop (Linux container)
────────────────                 ────────────────────────────────
Trace  :7070  ──localhost────►   supermemory-server :6767  ──►  Ollama :11434
(npm run dev)                    (memory + embeddings)          (on Windows host,
Ollama :11434 (native app)  ◄────host.docker.internal───────────  reached from container)
```

## 1. Prerequisites (all native Windows installers)

- **Docker Desktop for Windows** — https://www.docker.com/products/docker-desktop/
  (it sets up its own Linux engine; you only use the `docker` command).
- **Ollama for Windows** — https://ollama.com/download . Then pull the model:
  ```powershell
  ollama pull qwen2.5:7b
  ```
- **Node.js 20+** (you already have it) for running Trace.

## 2. Start Supermemory Local in Docker

From the repo root:

```powershell
docker compose up --build
```

First boot downloads the Linux binary, initializes the graph engine, and **prints your API
key** in the `sm_...` format to the logs. Copy it. All state persists in `./.supermemory/`
(mounted into the container), so restarts keep your key and memories.

Verify it is reachable from Windows:

```powershell
curl http://localhost:6767/v3/documents -H "Authorization: Bearer sm_xxx"
```

Any HTTP response (even 401/404) means it is up and the port is mapped.

> Troubleshooting: if `curl` cannot connect but the container is running, the server may be
> binding to localhost inside the container. Check `docker compose logs supermemory` for the
> bind address; the compose file already sets `HOST`/`PORT` to `0.0.0.0:6767` to avoid this.
> On Apple Silicon rebuild with `--build-arg SM_PLATFORM=linux-arm64`.

## 3. Run Trace (native Windows)

```powershell
copy .env.example .env.local     # set SUPERMEMORY_API_KEY=sm_xxx
npm install
npm run dev                      # http://localhost:7070
```

Health check should now show Supermemory reachable:

```powershell
curl http://localhost:7070/api/health
# { "ok": true, "supermemory": { "reachable": true, ... } }
```

Seed the demo history and watch the guard fire:

```powershell
npm run seed
```

Open the dashboard at http://localhost:7070.

## Offline proof

With the model pulled and the container running, turn off networking. Add and search still
work: embeddings, storage, extraction (Ollama), and Trace's detection are all on your
machine. Data lives only in `./.supermemory/`.
