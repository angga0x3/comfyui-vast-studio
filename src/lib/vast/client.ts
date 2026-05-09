import { getEnv } from "../env";

export interface VastInstance {
  id: number;
  actual_status: string | null;
  intended_status: string | null;
  cur_state: string | null;
  next_state: string | null;
  ssh_host: string | null;
  ssh_port: number | null;
  public_ipaddr: string | null;
  ports: Record<string, Array<{ HostIp: string; HostPort: string }>> | null;
  gpu_name: string | null;
  num_gpus: number | null;
  dph_total: number | null;
  image_runtype: string | null;
  label: string | null;
}

export type VastInstanceStatus = "running" | "stopped" | "starting" | "stopping" | "unknown";

function normalizeStatus(inst: VastInstance): VastInstanceStatus {
  const actual = (inst.actual_status || "").toLowerCase();
  const intended = (inst.intended_status || "").toLowerCase();
  if (actual === "running") return "running";
  if (actual === "exited" || actual === "stopped") {
    if (intended === "running") return "starting";
    return "stopped";
  }
  if (actual === "loading" || actual === "scheduling" || actual === "created") return "starting";
  if (intended === "stopped" && actual !== "stopped") return "stopping";
  return "unknown";
}

export class VastClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    const env = getEnv();
    this.apiKey = apiKey ?? env.VAST_API_KEY;
    this.baseUrl = (baseUrl ?? env.VAST_API_URL).replace(/\/$/, "");
    if (!this.apiKey) {
      throw new Error("VAST_API_KEY is not configured");
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (init?.headers) Object.assign(headers, init.headers as Record<string, string>);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vast.ai API ${res.status} ${res.statusText} on ${path}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async getInstance(instanceId: string | number): Promise<VastInstance> {
    const data = await this.request<{ instances: VastInstance }>(`/instances/${instanceId}/`);
    return data.instances;
  }

  async getInstanceStatus(instanceId: string | number): Promise<{
    status: VastInstanceStatus;
    raw: VastInstance;
  }> {
    const inst = await this.getInstance(instanceId);
    return { status: normalizeStatus(inst), raw: inst };
  }

  async startInstance(instanceId: string | number): Promise<void> {
    await this.request(`/instances/request_state/${instanceId}/`, {
      method: "PUT",
      body: JSON.stringify({ state: "running" }),
    });
  }

  async stopInstance(instanceId: string | number): Promise<void> {
    await this.request(`/instances/request_state/${instanceId}/`, {
      method: "PUT",
      body: JSON.stringify({ state: "stopped" }),
    });
  }

  async destroyInstance(instanceId: string | number): Promise<void> {
    await this.request(`/instances/${instanceId}/`, { method: "DELETE" });
  }

  async waitForRunning(
    instanceId: string | number,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<VastInstance> {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { status, raw } = await this.getInstanceStatus(instanceId);
      if (status === "running") return raw;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Timed out waiting for Vast.ai instance ${instanceId} to become running`);
  }
}

export { normalizeStatus };
