"use client";

import { useState } from "react";
import { Boxes } from "lucide-react";

import { GpuStatusCard } from "@/components/gpu-status-card";
import { JobForm } from "@/components/job-form";
import { JobList } from "@/components/job-list";

export default function HomePage() {
  const [refresh, setRefresh] = useState(0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">ComfyUI Vast Studio</h1>
            <p className="text-xs text-muted-foreground">
              Image-to-3D (Hunyuan3D) on Vast.ai GPUs · auto start/stop on idle
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <JobForm onCreated={() => setRefresh((r) => r + 1)} />
          <section className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Jobs
            </h2>
            <JobList refreshSignal={refresh} />
          </section>
        </div>
        <aside className="space-y-4">
          <GpuStatusCard />
        </aside>
      </div>
    </main>
  );
}
