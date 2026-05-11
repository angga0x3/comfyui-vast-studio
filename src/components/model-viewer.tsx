"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X, RotateCw, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { DetailedHTMLProps, HTMLAttributes } from "react";

// Google's <model-viewer> Web Component is loaded dynamically client-side so we
// can drop it into JSX without server-rendering the custom element.
type ModelViewerAttrs = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  alt?: string;
  poster?: string;
  "auto-rotate"?: boolean;
  "auto-rotate-delay"?: string | number;
  "rotation-per-second"?: string;
  "camera-controls"?: boolean;
  "shadow-intensity"?: string | number;
  "environment-image"?: string;
  exposure?: string | number;
  ar?: boolean;
  "ar-modes"?: string;
  loading?: "auto" | "lazy" | "eager";
  reveal?: "auto" | "manual";
  "interaction-prompt"?: "auto" | "none" | "when-focused";
  "camera-orbit"?: string;
  "min-camera-orbit"?: string;
  "max-camera-orbit"?: string;
  "field-of-view"?: string;
};

interface ModelViewerElement extends HTMLElement {
  cameraOrbit: string;
  fieldOfView: string;
  resetTurntableRotation?: () => void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttrs;
    }
  }
}

let scriptPromise: Promise<void> | null = null;

function ensureScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  if (window.customElements?.get("model-viewer")) {
    scriptPromise = Promise.resolve();
    return scriptPromise;
  }
  scriptPromise = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-model-viewer="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.type = "module";
    s.src =
      "https://unpkg.com/@google/model-viewer@4.0.0/dist/model-viewer.min.js";
    s.dataset.modelViewer = "true";
    s.addEventListener("load", () => resolve(), { once: true });
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface ViewerProps {
  src: string;
  poster?: string;
  alt?: string;
  autoRotate: boolean;
  controlsId: string;
}

function Viewer({ src, poster, alt, autoRotate, controlsId }: ViewerProps) {
  const ref = useRef<ModelViewerElement | null>(null);

  useEffect(() => {
    ensureScript();
  }, []);

  // Expose ref through a data attribute lookup so the parent can reset orbit.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.dataset.controlsId = controlsId;
  }, [controlsId]);

  return (
    <model-viewer
      ref={(el: ModelViewerElement | null) => {
        ref.current = el;
        if (el) el.dataset.controlsId = controlsId;
      }}
      src={src}
      poster={poster}
      alt={alt ?? "Generated 3D model"}
      camera-controls
      auto-rotate={autoRotate || undefined}
      rotation-per-second="30deg"
      ar
      ar-modes="webxr scene-viewer quick-look"
      shadow-intensity="1"
      exposure="1"
      loading="lazy"
      reveal="auto"
      interaction-prompt="when-focused"
      camera-orbit="0deg 75deg auto"
      min-camera-orbit="auto auto 0.5m"
      max-camera-orbit="auto auto 10m"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        backgroundColor: "#0b0b0b",
      }}
    />
  );
}

interface ModelViewerProps {
  src: string;
  className?: string;
  poster?: string;
  alt?: string;
}

let nextId = 0;
function useControlsId(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = `mv-${++nextId}`;
  return ref.current;
}

function resetView(controlsId: string) {
  if (typeof document === "undefined") return;
  const el = document.querySelector<ModelViewerElement>(
    `model-viewer[data-controls-id="${controlsId}"]`,
  );
  if (!el) return;
  el.cameraOrbit = "0deg 75deg auto";
  el.fieldOfView = "auto";
  if (typeof el.resetTurntableRotation === "function") {
    el.resetTurntableRotation();
  }
}

export function ModelViewer({ src, className, poster, alt }: ModelViewerProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const inlineId = useControlsId();
  const fullId = useControlsId();

  // Close fullscreen on ESC.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const toggleRotate = useCallback(() => setAutoRotate((v) => !v), []);

  return (
    <>
      <div className={`relative group overflow-hidden rounded-md border bg-black ${className ?? ""}`}>
        <Viewer
          src={src}
          poster={poster}
          alt={alt}
          autoRotate={autoRotate}
          controlsId={inlineId}
        />

        {/* Hint pill — fades out on hover so it doesn't get in the way. */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white/85 backdrop-blur transition-opacity group-hover:opacity-0">
          drag to orbit · scroll to zoom
        </div>

        {/* Floating controls */}
        <div className="absolute right-2 top-2 flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/75 hover:text-white"
            onClick={toggleRotate}
            title={autoRotate ? "Pause auto-rotate" : "Start auto-rotate"}
            aria-label={autoRotate ? "Pause auto-rotate" : "Start auto-rotate"}
          >
            <RotateCw className={`h-3.5 w-3.5 ${autoRotate ? "" : "opacity-50"}`} />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/75 hover:text-white"
            onClick={() => resetView(inlineId)}
            title="Reset view"
            aria-label="Reset view"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/75 hover:text-white"
            onClick={() => setFullscreen(true)}
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {fullscreen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-xs text-white/70">
            <span>3D preview · drag to orbit · scroll to zoom · ESC to close</span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1 bg-white/10 text-white hover:bg-white/20"
                onClick={toggleRotate}
              >
                <RotateCw className={`h-3.5 w-3.5 ${autoRotate ? "" : "opacity-50"}`} />
                {autoRotate ? "Rotating" : "Paused"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1 bg-white/10 text-white hover:bg-white/20"
                onClick={() => resetView(fullId)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reset
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-7 w-7 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setFullscreen(false)}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="relative flex-1">
            <Viewer
              src={src}
              poster={poster}
              alt={alt}
              autoRotate={autoRotate}
              controlsId={fullId}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
