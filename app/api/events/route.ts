import type { NextRequest } from "next/server";
import { subscribe, events, type LedgerEvent } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/events — Server-Sent Events feed of integrity events.
//
// Because Trace is the write path, every detected relation is pushed here the instant it
// happens (no polling, no webhook needed). The dashboard's live drift feed subscribes here.
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LedgerEvent) => {
        controller.enqueue(encoder.encode(`event: relation\ndata: ${JSON.stringify(e)}\n\n`));
      };

      // Replay the recent backlog so a freshly-opened dashboard is not empty.
      for (const e of events().slice(-50)) send(e);
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));

      const unsubscribe = subscribe(send);
      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 15000);

      const close = () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
