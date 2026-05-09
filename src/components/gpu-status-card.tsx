"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu, Power, PowerOff, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GpuStatus = "running" | "stopped" | "starting" | "stopping" | "unknown";

interface GpuState {
  status: GpuStatus;
  instanceId: string | null;
  comfyUrl: string | null;
  lastJobAt: string | null;
  vastConfigured: boolean;
  comfyConfigured: boolean;
  idleTimeoutMinutes: number;
  autoWake: boolean;
}

const STATUS_VARIANT: Record<GpuStatus, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  running: "success",
  stopped: "secondary",
  starting: "warning",
  stopping: "warning",
  unknown: "outline",
};

export function GpuStatusCard() {
  const [state, setState] = useState<GpuState | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/gpu/status${refresh ? "?refresh=1" : ""}`);
      const data = (await res.json()) as GpuState;
      setState(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load GPU status");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(false), 10_000);
    return () => clearInterval(t);
  }, []);

  async function wake() {
    setBusy(true);
    try {
      const res = await fetch("/api/gpu/wake", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Wake signal sent. GPU starting.");
      setState(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/gpu/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Stop signal sent.");
      setState(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          GPU Instance
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => load(true)}
          disabled={busy}
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant={state ? STATUS_VARIANT[state.status] : "outline"}>
            {state?.status ?? "—"}
          </Badge>
          {state?.instanceId ? (
            <span className="text-xs text-muted-foreground">id: {state.instanceId}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          {state ? (
            <>
              <div>
                Vast.ai:{" "}
                <span className={state.vastConfigured ? "" : "text-amber-500"}>
                  {state.vastConfigured ? "configured" : "not configured"}
                </span>
              </div>
              <div>
                ComfyUI:{" "}
                <span className={state.comfyConfigured ? "" : "text-amber-500"}>
                  {state.comfyConfigured ? state.comfyUrl : "not configured"}
                </span>
              </div>
              <div>Auto-wake: {state.autoWake ? "on" : "off"}</div>
              <div>Idle timeout: {state.idleTimeoutMinutes} min</div>
              {state.lastJobAt ? (
                <div>Last job: {new Date(state.lastJobAt).toLocaleString()}</div>
              ) : null}
            </>
          ) : (
            <div>Loading…</div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={busy || !state?.vastConfigured || state?.status === "running"}
            onClick={wake}
            className="gap-1"
          >
            <Power className="h-3.5 w-3.5" /> Wake
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !state?.vastConfigured || state?.status !== "running"}
            onClick={stop}
            className="gap-1"
          >
            <PowerOff className="h-3.5 w-3.5" /> Stop
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
