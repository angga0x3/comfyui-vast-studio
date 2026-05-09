import { NextResponse } from "next/server";
import { stopGpu } from "@/lib/gpu-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const state = await stopGpu();
    return NextResponse.json(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
