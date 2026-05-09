"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatBytes } from "@/lib/utils";

export interface UploadedAsset {
  id: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  publicUrl: string | null;
  previewUrl: string;
}

export function ImageUploader({
  value,
  onChange,
}: {
  value: UploadedAsset | null;
  onChange: (asset: UploadedAsset | null) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        toast.error("Only PNG, JPEG, or WebP images are supported");
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        onChange({ ...data, previewUrl });
      } catch (err) {
        URL.revokeObjectURL(previewUrl);
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  function handleSelect(files: FileList | null) {
    const f = files?.[0];
    if (f) void upload(f);
  }

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleSelect(e.dataTransfer.files);
      }}
      className={cn(
        "border-dashed transition-colors",
        dragActive ? "border-primary bg-accent" : "",
      )}
    >
      <CardContent className="p-4">
        {value ? (
          <div className="flex items-start gap-3">
            <img
              src={value.previewUrl}
              alt="Input"
              className="h-32 w-32 rounded-md object-cover border"
            />
            <div className="flex-1 space-y-2">
              <div className="text-sm">
                <div className="font-medium">{value.key.split("/").pop()}</div>
                <div className="text-muted-foreground">
                  {formatBytes(value.size)} · {value.mimeType}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  URL.revokeObjectURL(value.previewUrl);
                  onChange(null);
                }}
                className="gap-1"
              >
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-md py-8 text-sm text-muted-foreground hover:text-foreground"
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ImagePlus className="h-6 w-6" />
            )}
            <span>{uploading ? "Uploading…" : "Drop an image or click to upload"}</span>
            <span className="text-xs">PNG, JPEG, WebP · up to 25 MB</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleSelect(e.target.files)}
        />
      </CardContent>
    </Card>
  );
}
