"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

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

interface PresetMeta {
  id: string;
  name: string;
  description: string;
  defaults: {
    width: number;
    height: number;
    length: number;
    fps: number;
    steps: number;
    cfg: number;
    negativePrompt: string;
  };
}

export function JobForm({ onCreated }: { onCreated: () => void }) {
  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [width, setWidth] = useState(720);
  const [height, setHeight] = useState(1280);
  const [length, setLength] = useState(81);
  const [fps, setFps] = useState(16);
  const [seed, setSeed] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((d: { presets: PresetMeta[] }) => {
        setPresets(d.presets);
        if (d.presets[0]) {
          setPresetId(d.presets[0].id);
          setWidth(d.presets[0].defaults.width);
          setHeight(d.presets[0].defaults.height);
          setLength(d.presets[0].defaults.length);
          setFps(d.presets[0].defaults.fps);
          setNegativePrompt(d.presets[0].defaults.negativePrompt);
        }
      })
      .catch(() => toast.error("Failed to load presets"));
  }, []);

  function applyPreset(id: string) {
    setPresetId(id);
    const p = presets.find((p) => p.id === id);
    if (!p) return;
    setWidth(p.defaults.width);
    setHeight(p.defaults.height);
    setLength(p.defaults.length);
    setFps(p.defaults.fps);
    if (!negativePrompt) setNegativePrompt(p.defaults.negativePrompt);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) {
      toast.error("Please upload an input image first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Prompt is required");
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
          negativePrompt: negativePrompt.trim() || undefined,
          width,
          height,
          length,
          fps,
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
          <CardTitle>2. Workflow & prompt</CardTitle>
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
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              rows={3}
              placeholder="Describe the motion, camera, mood…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="neg">Negative prompt</Label>
            <Textarea
              id="neg"
              rows={2}
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Output settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div className="grid gap-1">
            <Label htmlFor="w">Width</Label>
            <Input id="w" type="number" min={64} max={2048} step={8} value={width} onChange={(e) => setWidth(+e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="h">Height</Label>
            <Input id="h" type="number" min={64} max={2048} step={8} value={height} onChange={(e) => setHeight(+e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="l">Frames</Label>
            <Input id="l" type="number" min={9} max={241} step={4} value={length} onChange={(e) => setLength(+e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fps">FPS</Label>
            <Input id="fps" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(+e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seed">Seed</Label>
            <Input id="seed" type="number" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={submitting} className="gap-2">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate video
      </Button>
    </form>
  );
}
