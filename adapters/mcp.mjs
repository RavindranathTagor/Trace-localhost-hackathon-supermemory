#!/usr/bin/env node
// Trace MCP server: gives a coding agent (Claude Code / Cursor) contradiction-aware
// access to your local memory. Point your agent at this and it can consult the memory
// BEFORE it writes code, so it never reintroduces something you already ruled out.
//
// Tools:
//   check_before_coding({ intent }) - dry-run: does this plan conflict with a decision?
//   remember({ text })              - store a decision; returns Trace's verdict
//   current_truth({ topic })        - the standing (non-superseded) memories on a topic
//
// It talks to the running Trace app over HTTP (default http://localhost:7070), so all
// detection stays local. Run with: npm run mcp

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TRACE = (process.env.TRACE_URL || "http://localhost:7070").replace(/\/+$/, "");

async function post(path, body) {
  const res = await fetch(`${TRACE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

const text = (s) => ({ content: [{ type: "text", text: s }] });

const TOOLS = [
  {
    name: "check_before_coding",
    description:
      "Check a coding intent/plan against the team's memory BEFORE writing code. Returns a conflict warning (drift/duplicate) with the prior decision, or an all-clear. Nothing is stored.",
    inputSchema: {
      type: "object",
      properties: { intent: { type: "string", description: "What you are about to do, e.g. 'use MongoDB for billing'" } },
      required: ["intent"],
    },
  },
  {
    name: "remember",
    description: "Store a decision/fact in local memory. Trace checks it against prior memory and returns whether it drifts, duplicates, reaffirms, or is new.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The decision or fact to remember" } },
      required: ["text"],
    },
  },
  {
    name: "current_truth",
    description: "Return the current, non-superseded memories on a topic (stale/reversed decisions are excluded).",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", description: "Topic/query, e.g. 'database'" } },
      required: ["topic"],
    },
  },
];

const server = new Server({ name: "trace", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === "check_before_coding") {
      const r = await post("/api/guard", { intent: String(args.intent ?? "") });
      if (r.conflict && r.top) {
        const t = r.top;
        return text(
          `⚠️ ${t.relation.toUpperCase()} (${Math.round(t.confidence * 100)}%, ${t.tier}): ${t.reason}\n` +
            `Prior decision: "${t.prior}"\nReconcile before proceeding.`,
        );
      }
      return text("✓ No conflict with prior memory. Safe to proceed.");
    }

    if (name === "remember") {
      const r = await post("/api/v3/documents", { content: String(args.text ?? "") });
      if (r.trace && r.trace.relation !== "none") {
        return text(
          `Stored. Detected ${r.trace.relation.toUpperCase()} (${Math.round(r.trace.confidence * 100)}%): ${r.trace.reason}`,
        );
      }
      return text("Stored. No conflict with prior memory.");
    }

    if (name === "current_truth") {
      const r = await post("/api/v4/search", { q: String(args.topic ?? "") });
      const lines = (r.results ?? []).map((h) => `- ${h.memory ?? h.chunk ?? ""}${h.why ? `  (${h.why})` : ""}`);
      const body = lines.length ? lines.join("\n") : "(no current memories on that topic)";
      const note = r.excludedSuperseded ? `\n\n(${r.excludedSuperseded} superseded memory/ies excluded)` : "";
      return text(body + note);
    }

    return text(`Unknown tool: ${name}`);
  } catch (err) {
    return text(`Trace error: ${err instanceof Error ? err.message : String(err)}. Is the Trace app running on ${TRACE}?`);
  }
});

await server.connect(new StdioServerTransport());
console.error(`[trace-mcp] connected, talking to Trace at ${TRACE}`);
