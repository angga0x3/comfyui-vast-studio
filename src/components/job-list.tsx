"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, ImageIcon, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "@/lib/utils";

interface Job {
  id: string;
  status: string;
  presetId: string;
  prompt: string;
  progress: number;
  width: number;
  height: number;
  length: number;
  fps: number;
  seed: number | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  inputImageUrl: string;
  outputUrl: string | null;
  outputMime: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  queued: "outline",
  starting_gpu: "warning",
  running: "warning",
  completed: "success",
  failed: "destructive",
  canceled: "secondary",
};

export function JobList({ refreshSignal }: { refreshSignal: number }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        const data = (await res.json()) as { jobs: Job[] };
        if (!cancelled) setJobs(data.jobs);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 4_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshSignal]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No jobs yet. Upload an image and submit your first generation.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <Card key={j.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-mono">{j.id.slice(0, 12)}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[j.status] ?? "outline"}>{j.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(j.createdAt)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-md border bg-muted">
                <Link href={j.inputImageUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={j.inputImageUrl} alt="input" className="h-full w-full object-cover" />
                </Link>
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm">{j.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  {j.presetId} · {j.width}×{j.height} · {j.length}f · {j.fps}fps
                  {j.seed != null ? ` · seed ${j.seed}` : ""}
                </p>
                {j.errorMessage ? (
                  <p className="text-xs text-destructive">{j.errorMessage}</p>
                ) : null}
              </div>
              {j.outputUrl ? (
                <div className="md:w-64">
                  {j.outputMime?.startsWith("video/") ? (
                    <video
                      src={j.outputUrl}
                      controls
                      loop
                      className="aspect-[9/16] w-full rounded-md border bg-black"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={j.outputUrl}
                      alt="output"
                      className="w-full rounded-md border"
                    />
                  )}
                  <div className="mt-2">
                    <Link
                      href={j.outputUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Download className="h-3 w-3" /> Download
                    </Link>
                  </div>
                </div>
              ) : j.status === "running" || j.status === "starting_gpu" || j.status === "queued" ? (
                <div className="md:w-64 flex flex-col justify-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {j.status === "queued"
                      ? "Waiting for worker"
                      : j.status === "starting_gpu"
                        ? "Booting GPU"
                        : "Generating"}
                  </span>
                  <Progress value={Math.round((j.progress ?? 0) * 100)} />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
