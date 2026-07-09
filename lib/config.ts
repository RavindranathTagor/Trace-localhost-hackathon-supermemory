// Central config, read once from the environment. Everything Trace needs to talk to
// Supermemory Local (the memory backend) and the local models (judge + NLI).

function env(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  sm: {
    // Supermemory Local, `supermemory-server` on :6767 (in WSL2 from Windows).
    baseUrl: env("SUPERMEMORY_BASE_URL", "http://localhost:6767").replace(/\/+$/, ""),
    apiKey: env("SUPERMEMORY_API_KEY"),
    // The namespace Trace scopes all memory under.
    containerTag: env("TRACE_CONTAINER_TAG", "trace"),
  },
  ollama: {
    // OpenAI-compatible endpoint for the local judge tier and rationale phrasing.
    baseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434/v1").replace(/\/+$/, ""),
    model: env("OLLAMA_MODEL", "qwen2.5:7b"),
  },
  nli: {
    model: env("TRACE_NLI_MODEL", "Xenova/nli-deberta-v3-small"),
  },
  detect: {
    // Below this Supermemory similarity, a prior is treated as a different topic.
    topicGate: num("TRACE_TOPIC_GATE", 0.4),
  },
} as const;

export function smConfigured(): boolean {
  return !!config.sm.baseUrl && !!config.sm.apiKey;
}
