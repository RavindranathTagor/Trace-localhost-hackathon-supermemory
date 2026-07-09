# Running Trace locally on Windows (WSL2 + Ollama)

Supermemory Local ships a macOS/Linux binary, so on Windows 11 it runs inside **WSL2**.
Services listening in WSL2 are reachable from Windows at `localhost`, so Trace (running
on Windows via `npm run dev`) can talk to `supermemory-server` at `http://localhost:6767`.

Topology (all local, nothing leaves the machine):

```
Windows                         WSL2 (Ubuntu)
─────────                       ───────────────────────────
Trace  :7070  ──localhost──►    supermemory-server :6767 ──►  Ollama :11434
(npm run dev)                   (memory + embeddings)         (extraction + judge)
```

## 1. Install WSL2 (once)

In an elevated PowerShell:

```powershell
wsl --install -d Ubuntu
```

Reboot if prompted, then open the **Ubuntu** terminal and finish the user setup.

## 2. Install Ollama in WSL2 and pull a model

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &            # starts the API on :11434
ollama pull qwen2.5:7b    # extraction + Trace's judge tier
```

## 3. Install and run Supermemory Local in WSL2

```bash
curl -fsSL https://supermemory.ai/install | bash
# fully offline: point extraction at local Ollama
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_API_KEY=ollama
export OPENAI_MODEL=qwen2.5:7b
supermemory-server
```

First boot prints your API key in the `sm_...` format and confirms it is listening on
`http://localhost:6767`. Copy that key. All state lives in `./.supermemory/`.

## 4. Verify reachability from Windows

In a Windows terminal (Git Bash / PowerShell):

```bash
curl http://localhost:6767/v3/documents -H "Authorization: Bearer sm_xxx"
```

Any HTTP response (even 401/404) means the server is up and reachable across the WSL
boundary. A connection error means WSL networking is not forwarding yet; restart the
server or run `wsl --shutdown` and relaunch.

## 5. Configure and run Trace (on Windows)

```bash
cd d:/Hangover/trace-supermemory
cp .env.example .env.local     # set SUPERMEMORY_API_KEY=sm_xxx
npm run dev                    # http://localhost:7070
```

Health check, confirms Trace can see Supermemory Local:

```bash
curl http://localhost:7070/api/health
# { "ok": true, "supermemory": { "reachable": true, ... } }
```

Round-trip a memory through Trace's proxy:

```bash
curl -X POST http://localhost:7070/api/v3/documents \
  -H "Content-Type: application/json" \
  -d '{"content":"We standardized on Postgres for all services."}'

curl -X POST http://localhost:7070/api/v4/search \
  -H "Content-Type: application/json" \
  -d '{"q":"database"}'
```

## Offline proof

Once the model is pulled and the server is running, disable networking (airplane mode
or `wsl --shutdown` of any non-essential distro). Add and search still work: embeddings,
storage, extraction, and Trace's detection are all on-device.
