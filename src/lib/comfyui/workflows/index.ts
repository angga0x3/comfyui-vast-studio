import hunyuan3d21 from "./hunyuan3d-2.1.json";

export interface WorkflowParams {
  inputImageName: string;
  prompt: string;
  seed: number;
  steps?: number;
  cfg?: number;
  latentResolution?: number;
  octreeResolution?: number;
  voxelThreshold?: number;
}

export interface WorkflowDefaults {
  steps: number;
  cfg: number;
  latentResolution: number;
  octreeResolution: number;
  voxelThreshold: number;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  kind: "3d";
  outputMime: string;
  outputExt: string;
  defaults: WorkflowDefaults;
  /**
   * Returns a fresh copy of the workflow JSON (API format) ready to POST to
   * ComfyUI's /prompt with the provided parameters injected.
   */
  build: (params: WorkflowParams) => Record<string, unknown>;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

const hunyuan3d21Defaults: WorkflowDefaults = {
  steps: 30,
  cfg: 5,
  latentResolution: 3072,
  octreeResolution: 256,
  voxelThreshold: 0.6,
};

export const PRESETS: WorkflowMeta[] = [
  {
    id: "hunyuan3d-21",
    name: "Hunyuan3D 2.1 (Image to 3D)",
    description:
      "Tencent Hunyuan3D 2.1 — turn a single image into a textured .glb mesh. ~1–3 min per job on a 4090.",
    kind: "3d",
    outputMime: "model/gltf-binary",
    outputExt: "glb",
    defaults: hunyuan3d21Defaults,
    build(params) {
      const wf = clone(hunyuan3d21) as Record<string, Record<string, unknown>>;
      const get = (id: string) => wf[id] as { inputs: Record<string, unknown> };

      // LoadImage filename
      get("2").inputs.image = params.inputImageName;

      // EmptyLatentHunyuan3Dv2 resolution
      get("4").inputs.resolution =
        params.latentResolution ?? hunyuan3d21Defaults.latentResolution;

      // KSampler
      const sampler = get("7").inputs;
      sampler.seed = params.seed;
      sampler.steps = params.steps ?? hunyuan3d21Defaults.steps;
      sampler.cfg = params.cfg ?? hunyuan3d21Defaults.cfg;

      // VAEDecodeHunyuan3D octree resolution
      get("8").inputs.octree_resolution =
        params.octreeResolution ?? hunyuan3d21Defaults.octreeResolution;

      // VoxelToMesh threshold
      get("9").inputs.threshold = params.voxelThreshold ?? hunyuan3d21Defaults.voxelThreshold;

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
