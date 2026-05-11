import { prisma } from "../db";
import { getEnv } from "../env";
import { ComfyClient, type ComfyOutputFile } from "../comfyui/client";
import { ensureGpuReady } from "../gpu-manager";
import { getPreset } from "../comfyui/workflows";
import { resolveDownloadUrl, uploadBuffer, makeAssetKey } from "../storage";

function inferExt(filename: string, fallback: string): string {
  const m = filename.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : fallback;
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "glb":
      return "model/gltf-binary";
    case "gltf":
      return "model/gltf+json";
    case "obj":
      return "text/plain";
    case "ply":
      return "application/octet-stream";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function isOutputFileLike(v: unknown): v is ComfyOutputFile {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.filename === "string" &&
    typeof o.subfolder === "string" &&
    typeof o.type === "string"
  );
}

/**
 * Walk through a ComfyUI history entry's outputs and find the first file whose
 * filename ends with `expectedExt` (case-insensitive). SaveGLB does not always
 * use a predictable ui dict key, so we scan all values defensively.
 */
function findOutputFile(
  outputs: Record<string, Record<string, unknown>>,
  expectedExt: string,
): ComfyOutputFile | null {
  const wantExt = expectedExt.toLowerCase();
  let firstAny: ComfyOutputFile | null = null;
  for (const nodeOutput of Object.values(outputs)) {
    for (const value of Object.values(nodeOutput)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (!isOutputFileLike(entry)) continue;
        const ext = inferExt(entry.filename, "");
        if (ext === wantExt) return entry;
        if (!firstAny) firstAny = entry;
      }
    }
  }
  return firstAny;
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
    const bodyPreview = await imgRes.text().catch(() => "");
    const detail = bodyPreview ? ` (${bodyPreview.substring(0, 200)})` : "";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: `Failed to fetch input image: ${imgRes.status}${detail}`,
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
    seed,
    steps: job.steps ?? undefined,
    cfg: job.cfg ?? undefined,
    latentResolution: job.latentResolution ?? undefined,
    octreeResolution: job.octreeResolution ?? undefined,
    voxelThreshold: job.voxelThreshold ?? undefined,
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

  // Scan all ComfyUI output node arrays for a file matching the preset's
  // expected extension. SaveGLB does not always use a predictable ui dict key,
  // so we walk every array value and match by filename suffix.
  const outputs = history.outputs ?? {};
  const outputFile = findOutputFile(outputs, preset.outputExt);
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
  const outExt = inferExt(outputFile.filename, preset.outputExt);
  const outMime = outExt === preset.outputExt ? preset.outputMime : mimeFromExt(outExt);
  const assetId = `out_${job.id}`;
  const key = makeAssetKey("output", assetId, outputFile.filename);
  const upload = await uploadBuffer({ key, body: outputBuf, contentType: outMime });

  const asset = await prisma.asset.create({
    data: {
      kind: preset.kind === "3d" ? "output_mesh" : "output",
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
