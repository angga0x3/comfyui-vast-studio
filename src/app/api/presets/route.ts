import { NextResponse } from "next/server";
import { PRESETS } from "@/lib/comfyui/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    presets: PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      kind: p.kind,
      outputMime: p.outputMime,
      outputExt: p.outputExt,
      defaults: p.defaults,
    })),
  });
}
