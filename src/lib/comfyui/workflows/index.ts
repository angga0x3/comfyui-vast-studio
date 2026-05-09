import wan22I2v from "./wan22-i2v.json";

export interface WorkflowParams {
  inputImageName: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  length: number;
  fps: number;
  seed: number;
  steps?: number;
  cfg?: number;
}

export interface WorkflowMeta {
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
  /**
   * Returns a fresh copy of the workflow JSON (API format) ready to POST to ComfyUI's /prompt
   * with the provided parameters injected.
   */
  build: (params: WorkflowParams) => Record<string, unknown>;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

const wan22Defaults = {
  width: 720,
  height: 1280,
  length: 81,
  fps: 16,
  steps: 20,
  cfg: 6,
  negativePrompt:
    "low quality, worst quality, blurry, distorted, watermark, text, ugly, deformed",
};

export const PRESETS: WorkflowMeta[] = [
  {
    id: "wan22-i2v",
    name: "WAN 2.2 Image-to-Video",
    description:
      "WAN 2.2 14B I2V (high noise FP8). High quality cinematic motion from a single image.",
    defaults: wan22Defaults,
    build(params) {
      const wf = clone(wan22I2v) as Record<string, Record<string, unknown>>;
      const get = (id: string) => wf[id] as { inputs: Record<string, unknown> };

      // LoadImage filename
      get("14").inputs.image = params.inputImageName;

      // Positive / negative prompts
      get("6").inputs.text = params.prompt;
      get("7").inputs.text = params.negativePrompt ?? wan22Defaults.negativePrompt;

      // KSampler
      const sampler = get("3").inputs;
      sampler.seed = params.seed;
      sampler.steps = params.steps ?? wan22Defaults.steps;
      sampler.cfg = params.cfg ?? wan22Defaults.cfg;

      // WanImageToVideo
      const wan = get("12").inputs;
      wan.width = params.width;
      wan.height = params.height;
      wan.length = params.length;

      // VHS video combine fps
      get("9").inputs.frame_rate = params.fps;

      return wf;
    },
  },
];

export function getPreset(id: string): WorkflowMeta | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function defaultPresetId(): string {
  return PRESETS[0].id;
}
