import { prisma } from "../db";
import { getEnv } from "../env";
import { ComfyClient } from "../comfyui/client";
import { ensureGpuReady } from "../gpu-manager";
import { getPreset } from "../comfyui/workflows";
import { resolveDownloadUrl, uploadBuffer, makeAssetKey } from "../storage";

const VIDEO_EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/gif": "gif",
};

function inferExt(filename: string, fallback = "mp4"): string {
  const m = filename.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : fallback;
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "gif":
      return "image/gif";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

/**
 * Run a single job end-to-end: ensure GPU, upload input image to ComfyUI,
 * inject params into workflow, submit prompt, stream progress, fetch output,
 * upload output to S3, update Job row.
 */
export async function processJob(jobId: string): Promise<void> {
  const env = getEnv();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { inputImage: true },
  });
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "queued") {
    console.warn(`Job ${jobId} is in status ${job.status}; skipping`);
    return;
  }

  const preset = getPreset(job.presetId);
  if (!preset) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: `Unknown preset ${job.presetId}` },
    });
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "starting_gpu", startedAt: new Date() },
  });

  let comfyUrl: string;
  try {
    const ready = await ensureGpuReady();
    comfyUrl = ready.comfyUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: `GPU not ready: ${msg}`, finishedAt: new Date() },
    });
    return;
  }

  const comfy = new ComfyClient(comfyUrl, env.COMFYUI_CLIENT_ID);

  // Download input image bytes (from S3/R2 or via signed url)
  const downloadUrl = await resolveDownloadUrl(job.inputImage);
  const imgRes = await fetch(downloadUrl);
  if (!imgRes.ok) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: `Failed to fetch input image: ${imgRes.status}`,
        finishedAt: new Date(),
      },
    });
    return;
  }
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  const inputExt = inferExt(job.inputImage.key, "png");
  const comfyInputName = `cvs_${job.id}.${inputExt}`;
  await comfy.uploadImage({
    filename: comfyInputName,
    body: imgBuf,
    contentType: job.inputImage.mimeType || mimeFromExt(inputExt),
    overwrite: true,
  });

  const seed = job.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const workflow = preset.build({
    inputImageName: comfyInputName,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt ?? undefined,
    width: job.width,
    height: job.height,
    length: job.length,
    fps: job.fps,
    seed,
    steps: job.steps ?? undefined,
    cfg: job.cfg ?? undefined,
  });

  const { prompt_id } = await comfy.submitPrompt(workflow);
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "running", promptId: prompt_id, seed },
  });

  let history;
  try {
    history = await comfy.streamUntilComplete({
      promptId: prompt_id,
      onProgress: async (e) => {
        if (e.type === "progress") {
          const fraction = e.max > 0 ? Math.min(1, e.value / e.max) : 0;
          await prisma.job.update({
            where: { id: jobId },
            data: { progress: fraction },
          });
        }
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg, finishedAt: new Date() },
    });
    return;
  }

  // Find video / gif output across all node outputs.
  const outputs = history.outputs ?? {};
  let outputFile: { filename: string; subfolder: string; type: string; format?: string } | null =
    null;
  for (const nodeOutput of Object.values(outputs)) {
    const candidates = [
      ...(nodeOutput.gifs ?? []),
      ...(nodeOutput.videos ?? []),
      ...(nodeOutput.images ?? []).map((img) => ({ ...img, format: undefined as string | undefined })),
    ];
    if (candidates.length > 0) {
      outputFile = candidates[0];
      break;
    }
  }
  if (!outputFile) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: "ComfyUI did not return any output file",
        finishedAt: new Date(),
        comfyHistory: JSON.stringify(history),
      },
    });
    return;
  }

  const outputBuf = await comfy.fetchOutput({
    filename: outputFile.filename,
    subfolder: outputFile.subfolder,
    type: outputFile.type,
  });
  const outExt = inferExt(outputFile.filename, "mp4");
  const outMime = VIDEO_EXT_BY_MIME[outputFile.format ?? ""] ?? mimeFromExt(outExt);
  const assetId = `out_${job.id}`;
  const key = makeAssetKey("output", assetId, outputFile.filename);
  const upload = await uploadBuffer({ key, body: outputBuf, contentType: outMime });

  const asset = await prisma.asset.create({
    data: {
      kind: outExt === "gif" ? "output_image" : "output_video",
      bucket: upload.bucket,
      key: upload.key,
      mimeType: upload.mimeType,
      size: upload.size,
      publicUrl: upload.publicUrl,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "completed",
      outputAssetId: asset.id,
      progress: 1,
      finishedAt: new Date(),
      comfyHistory: JSON.stringify(history),
    },
  });

  await prisma.gpuState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", status: "running", lastJobAt: new Date() },
    update: { lastJobAt: new Date() },
  });
}
