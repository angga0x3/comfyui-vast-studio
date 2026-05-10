import WebSocket from "ws";
import { randomUUID } from "node:crypto";

export interface ComfyUploadResult {
  name: string;
  subfolder: string;
  type: string;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
  format?: string;
}

export interface ComfyHistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, Record<string, unknown>>;
  prompt?: unknown;
}

export type ComfyProgressEvent =
  | { type: "executing"; node: string | null; promptId: string }
  | { type: "progress"; value: number; max: number; node: string; promptId: string }
  | { type: "executed"; node: string; promptId: string }
  | { type: "execution_error"; message: string; promptId: string }
  | { type: "execution_cached"; nodes: string[]; promptId: string }
  | { type: "status"; queueRemaining: number };

export class ComfyClient {
  readonly baseUrl: string;
  readonly clientId: string;

  constructor(baseUrl: string, clientId?: string) {
    if (!baseUrl) throw new Error("ComfyUI base URL is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.clientId = clientId ?? randomUUID();
  }

  private toWsUrl(path: string): string {
    const u = new URL(this.baseUrl + path);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }

  async ping(timeoutMs = 5_000): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${this.baseUrl}/system_stats`, { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async waitUntilReady(timeoutMs = 5 * 60 * 1000, pollIntervalMs = 4_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.ping(3_000)) return;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`ComfyUI at ${this.baseUrl} did not become ready within ${timeoutMs}ms`);
  }

  async uploadImage(args: {
    filename: string;
    body: Buffer | Uint8Array;
    contentType: string;
    overwrite?: boolean;
    subfolder?: string;
  }): Promise<ComfyUploadResult> {
    const form = new FormData();
    // Copy into a fresh Uint8Array to satisfy Blob's BlobPart typing across Node versions.
    const bytes = new Uint8Array(args.body.byteLength);
    bytes.set(args.body);
    const blob = new Blob([bytes], { type: args.contentType });
    form.append("image", blob, args.filename);
    if (args.overwrite) form.append("overwrite", "true");
    if (args.subfolder) form.append("subfolder", args.subfolder);
    form.append("type", "input");
    const res = await fetch(`${this.baseUrl}/upload/image`, { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI upload failed ${res.status}: ${text}`);
    }
    return (await res.json()) as ComfyUploadResult;
  }

  async submitPrompt(workflow: Record<string, unknown>): Promise<{ prompt_id: string }> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI /prompt failed ${res.status}: ${text}`);
    }
    return (await res.json()) as { prompt_id: string };
  }

  async getHistory(promptId: string): Promise<ComfyHistoryEntry | null> {
    const res = await fetch(`${this.baseUrl}/history/${promptId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, ComfyHistoryEntry>;
    return data[promptId] ?? null;
  }

  async fetchOutput(args: {
    filename: string;
    subfolder: string;
    type: string;
  }): Promise<Buffer> {
    const url = new URL(`${this.baseUrl}/view`);
    url.searchParams.set("filename", args.filename);
    if (args.subfolder) url.searchParams.set("subfolder", args.subfolder);
    url.searchParams.set("type", args.type);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI /view failed ${res.status}: ${text}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * Subscribe to a prompt's progress via WebSocket. Resolves when the prompt finishes.
   * onProgress receives normalized events; throw to abort.
   */
  async streamUntilComplete(args: {
    promptId: string;
    onProgress?: (e: ComfyProgressEvent) => void | Promise<void>;
    timeoutMs?: number;
  }): Promise<ComfyHistoryEntry> {
    const wsUrl = this.toWsUrl(`/ws?clientId=${encodeURIComponent(this.clientId)}`);
    const timeoutMs = args.timeoutMs ?? 30 * 60 * 1000;

    return new Promise<ComfyHistoryEntry>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      const finish = (err?: Error, value?: ComfyHistoryEntry) => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        clearTimeout(timer);
        if (err) reject(err);
        else if (value) resolve(value);
      };
      const timer = setTimeout(
        () => finish(new Error(`ComfyUI prompt ${args.promptId} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );

      ws.on("error", (err) => finish(err));
      ws.on("close", () => {
        if (!settled) finish(new Error("ComfyUI WebSocket closed before completion"));
      });
      ws.on("message", async (raw) => {
        let parsed: { type: string; data?: Record<string, unknown> } | null = null;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!parsed) return;
        const data = parsed.data ?? {};
        try {
          switch (parsed.type) {
            case "executing": {
              const node = (data.node as string | null) ?? null;
              const promptId = (data.prompt_id as string) ?? "";
              if (promptId === args.promptId && node === null) {
                const history = await this.getHistory(args.promptId);
                if (history) {
                  finish(undefined, history);
                  return;
                }
              }
              await args.onProgress?.({ type: "executing", node, promptId });
              break;
            }
            case "progress": {
              await args.onProgress?.({
                type: "progress",
                value: Number(data.value ?? 0),
                max: Number(data.max ?? 1),
                node: String(data.node ?? ""),
                promptId: String(data.prompt_id ?? ""),
              });
              break;
            }
            case "executed": {
              await args.onProgress?.({
                type: "executed",
                node: String(data.node ?? ""),
                promptId: String(data.prompt_id ?? ""),
              });
              break;
            }
            case "execution_error": {
              const msg = String(
                (data.exception_message as string) ??
                  (data.exception_type as string) ??
                  "Execution error",
              );
              const promptId = String(data.prompt_id ?? args.promptId);
              await args.onProgress?.({ type: "execution_error", message: msg, promptId });
              if (promptId === args.promptId) finish(new Error(msg));
              break;
            }
            case "execution_cached": {
              await args.onProgress?.({
                type: "execution_cached",
                nodes: (data.nodes as string[]) ?? [],
                promptId: String(data.prompt_id ?? ""),
              });
              break;
            }
            case "status": {
              const status = data.status as { exec_info?: { queue_remaining?: number } } | undefined;
              await args.onProgress?.({
                type: "status",
                queueRemaining: Number(status?.exec_info?.queue_remaining ?? 0),
              });
              break;
            }
            default:
              break;
          }
        } catch (handlerErr) {
          finish(handlerErr instanceof Error ? handlerErr : new Error(String(handlerErr)));
        }
      });
    });
  }
}
