import { NextResponse } from "next/server";
import { readGpuState, refreshGpuStatus } from "@/lib/gpu-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const state = refresh ? await refreshGpuStatus() : await readGpuState();
  return NextResponse.json(state);
}
