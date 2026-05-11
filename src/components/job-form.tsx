"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Boxes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { ImageUploader, type UploadedAsset } from "./image-uploader";

interface PresetDefaults {
  steps: number;
  cfg: number;
  latentResolution: number;
  octreeResolution: number;
  voxelThreshold: number;
}

interface PresetMeta {
  id: string;
  name: string;
  description: string;
  kind: "3d";
  outputMime: string;
  outputExt: string;
  defaults: PresetDefaults;
}

export function JobForm({ onCreated }: { onCreated: () => void }) {
  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [latentResolution, setLatentResolution] = useState(3072);
  const [octreeResolution, setOctreeResolution] = useState(256);
  const [voxelThreshold, setVoxelThreshold] = useState(0.6);
  const [steps, setSteps] = useState(30);
  const [cfg, setCfg] = useState(5);
  const [seed, setSeed] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((d: { presets: PresetMeta[] }) => {
        setPresets(d.presets);
        if (d.presets[0]) {
          setPresetId(d.presets[0].id);
          const dft = d.presets[0].defaults;
          setLatentResolution(dft.latentResolution);
          setOctreeResolution(dft.octreeResolution);
          setVoxelThreshold(dft.voxelThreshold);
          setSteps(dft.steps);
          setCfg(dft.cfg);
        }
      })
      .catch(() => toast.error("Failed to load presets"));
  }, []);

  function applyPreset(id: string) {
    setPresetId(id);
    const p = presets.find((p) => p.id === id);
    if (!p) return;
    setLatentResolution(p.defaults.latentResolution);
    setOctreeResolution(p.defaults.octreeResolution);
    setVoxelThreshold(p.defaults.voxelThreshold);
    setSteps(p.defaults.steps);
    setCfg(p.defaults.cfg);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) {
      toast.error("Please upload an input image first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Label is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAssetId: asset.id,
          presetId,
          prompt: prompt.trim(),
          latentResolution,
          octreeResolution,
          voxelThreshold,
          steps,
          cfg,
          seed: seed ? Number(seed) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create job");
      toast.success(`Job queued: ${data.id.slice(0, 8)}…`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const currentPreset = presets.find((p) => p.id === presetId);

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Input image</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploader value={asset} onChange={setAsset} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Workflow & label</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Workflow preset</Label>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentPreset ? (
              <p className="text-xs text-muted-foreground">{currentPreset.description}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prompt">Label / notes</Label>
            <Textarea
              id="prompt"
              rows={2}
              placeholder="Short description for this generation (Hunyuan3D uses the image only — this is just for your reference)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. 3D settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="latres">Latent resolution</Label>
            <Input
              id="latres"
              type="number"
              min={64}
              max={8192}
              step={64}
              value={latentResolution}
              onChange={(e) => setLatentResolution(+e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Higher = more shape detail (default 3072)</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="octree">Octree resolution</Label>
            <Input
              id="octree"
              type="number"
              min={16}
              max={512}
              step={16}
              value={octreeResolution}
              onChange={(e) => setOctreeResolution(+e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Higher = denser voxel grid (default 256)</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="thr">Voxel threshold</Label>
            <Input
              id="thr"
              type="number"
              min={-1}
              max={1}
              step={0.05}
              value={voxelThreshold}
              onChange={(e) => setVoxelThreshold(+e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Surface threshold (default 0.6)</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="steps">Steps</Label>
            <Input
              id="steps"
              type="number"
              min={1}
              max={80}
              value={steps}
              onChange={(e) => setSteps(+e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cfg">CFG</Label>
            <Input
              id="cfg"
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={cfg}
              onChange={(e) => setCfg(+e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seed">Seed</Label>
            <Input
              id="seed"
              type="number"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={submitting} className="gap-2">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
        Generate 3D model
      </Button>
    </form>
  );
}
