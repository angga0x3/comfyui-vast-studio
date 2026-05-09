import { NextResponse } from "next/server";
import { autoShutdownIfIdle } from "@/lib/gpu-manager";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const env = getEnv();
  if (!env.CRON_SECRET) return true; // not required if unset
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${env.CRON_SECRET}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === env.CRON_SECRET;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await autoShutdownIfIdle();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
