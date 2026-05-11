import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveDownloadUrl } from "@/lib/storage";
import { getPreset } from "@/lib/comfyui/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createJobSchema = z.object({
  inputAssetId: z.string().min(1),
  presetId: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  seed: z.number().int().optional(),
  steps: z.number().int().positive().max(80).optional(),
  cfg: z.number().positive().max(20).optional(),
  latentResolution: z.number().int().min(1).max(8192).optional(),
  octreeResolution: z.number().int().min(16).max(512).optional(),
  voxelThreshold: z.number().min(-1).max(1).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const preset = getPreset(input.presetId);
  if (!preset) {
    return NextResponse.json({ error: `Unknown preset ${input.presetId}` }, { status: 400 });
  }
  const asset = await prisma.asset.findUnique({ where: { id: input.inputAssetId } });
  if (!asset || asset.kind !== "input_image") {
    return NextResponse.json({ error: "Input asset not found" }, { status: 404 });
  }
  const job = await prisma.job.create({
    data: {
      presetId: input.presetId,
      prompt: input.prompt,
      seed: input.seed,
      steps: input.steps ?? preset.defaults.steps,
      cfg: input.cfg ?? preset.defaults.cfg,
      latentResolution: input.latentResolution ?? preset.defaults.latentResolution,
      octreeResolution: input.octreeResolution ?? preset.defaults.octreeResolution,
      voxelThreshold: input.voxelThreshold ?? preset.defaults.voxelThreshold,
      inputImageId: input.inputAssetId,
      status: "queued",
    },
  });
  return NextResponse.json({ id: job.id, status: job.status });
}

export async function GET() {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { inputImage: true, outputAsset: true },
  });
  const enriched = await Promise.all(
    jobs.map(async (j) => ({
      id: j.id,
      status: j.status,
      presetId: j.presetId,
      prompt: j.prompt,
      progress: j.progress,
      seed: j.seed,
      steps: j.steps,
      cfg: j.cfg,
      latentResolution: j.latentResolution,
      octreeResolution: j.octreeResolution,
      voxelThreshold: j.voxelThreshold,
      errorMessage: j.errorMessage,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      inputImageUrl: await resolveDownloadUrl(j.inputImage),
      outputUrl: j.outputAsset ? await resolveDownloadUrl(j.outputAsset) : null,
      outputMime: j.outputAsset?.mimeType ?? null,
    })),
  );
  return NextResponse.json({ jobs: enriched });
}
