import { prisma } from "./db";
import { getEnv, hasComfyConfigured, hasVastConfigured } from "./env";
import { ComfyClient } from "./comfyui/client";
import { VastClient } from "./vast/client";

export type GpuStatus = "running" | "stopped" | "starting" | "stopping" | "unknown";

export interface GpuStateView {
  status: GpuStatus;
  instanceId: string | null;
  comfyUrl: string | null;
  lastJobAt: Date | null;
  lastSeenAt: Date | null;
  vastConfigured: boolean;
  comfyConfigured: boolean;
  idleTimeoutMinutes: number;
  autoWake: boolean;
}

const SINGLETON_ID = "singleton";

async function loadOrInit() {
  const existing = await prisma.gpuState.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.gpuState.create({ data: { id: SINGLETON_ID } });
}

export async function readGpuState(): Promise<GpuStateView> {
  const env = getEnv();
  const row = await loadOrInit();
  return {
    status: (row.status as GpuStatus) ?? "unknown",
    instanceId: row.instanceId ?? env.VAST_INSTANCE_ID ?? null,
    comfyUrl: row.comfyUrl ?? env.COMFYUI_URL ?? null,
    lastJobAt: row.lastJobAt,
    lastSeenAt: row.lastSeenAt,
    vastConfigured: hasVastConfigured(),
    comfyConfigured: hasComfyConfigured(),
    idleTimeoutMinutes: env.GPU_IDLE_TIMEOUT_MINUTES,
    autoWake: env.GPU_AUTO_WAKE,
  };
}

async function persistStatus(status: GpuStatus, extra?: Partial<{ comfyUrl: string }>) {
  const env = getEnv();
  await prisma.gpuState.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      status,
      instanceId: env.VAST_INSTANCE_ID || null,
      comfyUrl: extra?.comfyUrl ?? env.COMFYUI_URL ?? null,
      lastSeenAt: new Date(),
    },
    update: {
      status,
      comfyUrl: extra?.comfyUrl ?? undefined,
      lastSeenAt: new Date(),
    },
  });
}

export async function refreshGpuStatus(): Promise<GpuStateView> {
  const env = getEnv();
  if (!hasVastConfigured()) {
    if (hasComfyConfigured()) {
      const ok = await new ComfyClient(env.COMFYUI_URL, env.COMFYUI_CLIENT_ID).ping(3_000);
      await persistStatus(ok ? "running" : "unknown");
    } else {
      await persistStatus("unknown");
    }
    return readGpuState();
  }
  try {
    const vast = new VastClient();
    const { status } = await vast.getInstanceStatus(env.VAST_INSTANCE_ID);
    await persistStatus(status);
  } catch (err) {
    console.error("refreshGpuStatus error", err);
    await persistStatus("unknown");
  }
  return readGpuState();
}

export async function wakeGpu(): Promise<GpuStateView> {
  const env = getEnv();
  if (!hasVastConfigured()) {
    throw new Error("Vast.ai is not configured (VAST_API_KEY, VAST_INSTANCE_ID required)");
  }
  const vast = new VastClient();
  const { status } = await vast.getInstanceStatus(env.VAST_INSTANCE_ID);
  if (status === "running") {
    await persistStatus("running");
    return readGpuState();
  }
  if (status === "stopped" || status === "unknown") {
    await vast.startInstance(env.VAST_INSTANCE_ID);
  }
  await persistStatus("starting");
  return readGpuState();
}

export async function stopGpu(): Promise<GpuStateView> {
  const env = getEnv();
  if (!hasVastConfigured()) {
    throw new Error("Vast.ai is not configured");
  }
  const vast = new VastClient();
  await vast.stopInstance(env.VAST_INSTANCE_ID);
  await persistStatus("stopping");
  return readGpuState();
}

/**
 * Ensure Vast instance is running AND ComfyUI responds. Used by the worker before
 * dispatching a job. Bumps lastJobAt.
 */
export async function ensureGpuReady(): Promise<{ comfyUrl: string }> {
  const env = getEnv();
  if (!hasComfyConfigured()) {
    throw new Error("COMFYUI_URL is not configured");
  }
  if (hasVastConfigured()) {
    const vast = new VastClient();
    const { status } = await vast.getInstanceStatus(env.VAST_INSTANCE_ID);
    if (status !== "running") {
      if (!env.GPU_AUTO_WAKE) {
        throw new Error(`GPU instance is ${status} and GPU_AUTO_WAKE is disabled`);
      }
      if (status === "stopped" || status === "starting" || status === "unknown") {
        if (status !== "starting") await vast.startInstance(env.VAST_INSTANCE_ID);
        await persistStatus("starting");
        await vast.waitForRunning(env.VAST_INSTANCE_ID, {
          timeoutMs: env.GPU_BOOT_TIMEOUT_SECONDS * 1000,
        });
      } else {
        throw new Error(`GPU instance is ${status}; cannot dispatch job`);
      }
    }
    await persistStatus("running");
  }
  const comfy = new ComfyClient(env.COMFYUI_URL, env.COMFYUI_CLIENT_ID);
  await comfy.waitUntilReady(env.GPU_BOOT_TIMEOUT_SECONDS * 1000);
  await prisma.gpuState.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, status: "running", lastJobAt: new Date(), comfyUrl: env.COMFYUI_URL },
    update: { status: "running", lastJobAt: new Date(), comfyUrl: env.COMFYUI_URL },
  });
  return { comfyUrl: env.COMFYUI_URL };
}

/**
 * Stop GPU if it has been idle longer than GPU_IDLE_TIMEOUT_MINUTES and no jobs
 * are queued/running. Returns true if it issued a stop command.
 */
export async function autoShutdownIfIdle(): Promise<{
  stopped: boolean;
  reason: string;
}> {
  const env = getEnv();
  if (!hasVastConfigured()) return { stopped: false, reason: "vast not configured" };

  const activeJob = await prisma.job.findFirst({
    where: { status: { in: ["queued", "starting_gpu", "running"] } },
    select: { id: true },
  });
  if (activeJob) return { stopped: false, reason: "active job in queue" };

  const state = await loadOrInit();
  const lastJobAt = state.lastJobAt;
  const idleMs = env.GPU_IDLE_TIMEOUT_MINUTES * 60 * 1000;
  if (lastJobAt && Date.now() - lastJobAt.getTime() < idleMs) {
    return { stopped: false, reason: "within idle window" };
  }

  const vast = new VastClient();
  const { status } = await vast.getInstanceStatus(env.VAST_INSTANCE_ID);
  if (status !== "running") {
    await persistStatus(status);
    return { stopped: false, reason: `instance already ${status}` };
  }
  await vast.stopInstance(env.VAST_INSTANCE_ID);
  await persistStatus("stopping");
  return { stopped: true, reason: "idle timeout exceeded" };
}
