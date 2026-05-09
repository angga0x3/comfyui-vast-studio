import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: { inputImage: true, outputAsset: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    presetId: job.presetId,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    progress: job.progress,
    width: job.width,
    height: job.height,
    length: job.length,
    fps: job.fps,
    seed: job.seed,
    steps: job.steps,
    cfg: job.cfg,
    promptId: job.promptId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    inputImageUrl: await resolveDownloadUrl(job.inputImage),
    outputUrl: job.outputAsset ? await resolveDownloadUrl(job.outputAsset) : null,
    outputMime: job.outputAsset?.mimeType ?? null,
  });
}
