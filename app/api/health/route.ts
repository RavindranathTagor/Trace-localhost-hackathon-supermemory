import { NextResponse } from "next/server";
import { config, smConfigured } from "@/lib/config";
import { health } from "@/lib/sm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness + whether Supermemory Local is reachable.
export async function GET() {
  const reachable = smConfigured() ? await health() : false;
  return NextResponse.json({
    ok: true,
    supermemory: {
      configured: smConfigured(),
      reachable,
      baseUrl: config.sm.baseUrl,
      containerTag: config.sm.containerTag,
    },
  });
}
