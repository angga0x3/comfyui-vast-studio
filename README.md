# ComfyUI Vast Studio

Personal control panel for **image-to-3D generation** with ComfyUI running on
a [Vast.ai](https://vast.ai/) GPU instance.

- Upload an image, pick a workflow preset (default **Hunyuan3D 2.1**) → get a textured `.glb` mesh.
- Auto **start the GPU** when there's a job to run, auto **stop on idle** to save money.
- Outputs are stored on **Cloudflare R2 / AWS S3** so you can access them from anywhere.
- The generated `.glb` is rendered in-browser with Google's `<model-viewer>` web component (orbit, AR, lighting).
- Single-user, optional Basic Auth password to protect the UI.

> Designed for personal use. SQLite + a single background worker, no Redis needed.

## Architecture

```
[Browser]
    │  upload image, submit job, watch progress, view .glb
    ▼
[Next.js app  (web + API routes)] ◄── SQLite (jobs, assets, gpu state)
    │  enqueues Job rows                 R2 / S3 (input image + output .glb)
    ▼
[Worker process  (npm run worker)]
    │  ensure GPU ready (start Vast.ai if stopped → wait for ComfyUI healthy)
    │  upload image to ComfyUI, POST /prompt, stream WebSocket progress
    │  download /view, upload to R2/S3, mark Job completed
    ▼
[ComfyUI on Vast.ai GPU]
```

The same worker also runs the **idle watcher**: every minute it checks the
queue. If there are no active jobs and the last finished job was more than
`GPU_IDLE_TIMEOUT_MINUTES` ago, it stops the Vast.ai instance.

You can also trigger the idle watcher externally via `GET /api/cron/idle-watcher`
(protected with `CRON_SECRET`) — useful when the worker isn't running 24/7
(e.g. on Vercel) but you still want auto-shutdown via Vercel Cron / GitHub
Actions / cron-job.org.

## Quick start (local development)

### 1. Prerequisites

- Node.js 18+ and npm
- A Vast.ai account with one running GPU instance pre-configured with ComfyUI
  (16+ GB VRAM is enough for shape-only Hunyuan3D 2.1; 24+ GB if you later add
  the texture-PBR stage. RTX 4090 / A6000 / L40 / 6000 Ada all work).
  - The instance must expose ComfyUI's HTTP port (default 8188) publicly.
  - Vast.ai shows the mapped port like `host:port` in the **"Open Ports"** section.
  - Required ComfyUI model — see ["Download Hunyuan3D 2.1 model"](#download-hunyuan3d-21-model-required) below.
  - **No custom node required** — Hunyuan3D 2.1 uses ComfyUI's built-in nodes
    (`EmptyLatentHunyuan3Dv2`, `Hunyuan3Dv2Conditioning`, `VAEDecodeHunyuan3D`,
    `VoxelToMesh`, `SaveGLB`). Make sure ComfyUI is up to date.
- A Cloudflare R2 bucket (or AWS S3 bucket) and access keys.

### 2. Install & configure

```bash
npm install
cp .env.example .env
# edit .env with your values (see "Environment variables" below)

# initialize SQLite db
npm run db:push
```

### 3. Run

In one terminal — Next.js web app:

```bash
npm run dev
# http://localhost:3000
```

In another terminal — background worker:

```bash
npm run worker
```

Or run both with `npm run dev:all`.

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | SQLite path. Default `file:./prisma/dev.db` |
| `S3_BUCKET` | yes | R2/S3 bucket name |
| `S3_ENDPOINT` | R2 only | e.g. `https://<accountid>.r2.cloudflarestorage.com`. Leave blank for AWS S3. |
| `S3_REGION` | yes | `auto` for R2, e.g. `us-east-1` for S3 |
| `S3_ACCESS_KEY_ID` | yes | R2/S3 access key |
| `S3_SECRET_ACCESS_KEY` | yes | R2/S3 secret |
| `S3_PUBLIC_URL` | optional | Public CDN/bucket URL prefix. If empty, presigned URLs are used. |
| `S3_FORCE_PATH_STYLE` | optional | `true` recommended for R2 |
| `VAST_API_KEY` | yes (for auto-start/stop) | Vast.ai API key (Account → API) |
| `VAST_INSTANCE_ID` | yes | The numeric instance id you reuse |
| `VAST_API_URL` | optional | Default `https://console.vast.ai/api/v0` |
| `COMFYUI_URL` | yes | e.g. `http://1.2.3.4:12345` (Vast.ai mapped host:port) |
| `COMFYUI_CLIENT_ID` | optional | WS client id, defaults to `comfyui-vast-studio` |
| `GPU_IDLE_TIMEOUT_MINUTES` | optional | Default `10` |
| `GPU_AUTO_WAKE` | optional | `true`/`false`. Default `true` |
| `GPU_BOOT_TIMEOUT_SECONDS` | optional | Default `600` (10 min). |
| `BASIC_AUTH_PASSWORD` | optional | If set, protects all routes with HTTP Basic auth |
| `CRON_SECRET` | optional | If set, required to call `/api/cron/idle-watcher` |

## How GPU lifecycle works

- When you submit a job, the worker calls `ensureGpuReady()`:
  1. Calls Vast.ai API for instance status.
  2. If `stopped` and `GPU_AUTO_WAKE=true`, sends `start` and waits up to
     `GPU_BOOT_TIMEOUT_SECONDS` for the instance to become `running`.
  3. Polls ComfyUI's `/system_stats` until it responds (i.e. ComfyUI is up).
  4. Bumps `GpuState.lastJobAt` and proceeds.
- After the job finishes, the worker keeps the instance running. Every minute
  it checks: if no active job and `Date.now() - lastJobAt > idleTimeout`, it
  calls Vast.ai stop.
- You can also manually wake/stop from the UI (top-right card).

To **destroy** the instance instead of stopping it (cheapest mode), see the
notes section below.

## Adding more workflow presets

Each preset is a workflow JSON exported from ComfyUI in **API format** plus a
small adapter that injects user inputs into specific node ids.

1. In ComfyUI's web UI, open your workflow → click **Save (API Format)** → you
   get a JSON file mapped by node id (e.g. `{"3": {"class_type": "...", ...}}`).
2. Drop it into `src/lib/comfyui/workflows/<your-preset>.json`.
3. Add an entry to `PRESETS` in `src/lib/comfyui/workflows/index.ts`. Implement
   `build(params)` to set the right node inputs from `params.inputImageName`,
   `params.seed`, etc., and set `outputMime` / `outputExt` so the dispatcher
   knows what to download.
4. The frontend will list it automatically via `/api/presets`.

### How the Hunyuan3D 2.1 template injects parameters

| Param | Node id | Inputs key |
| --- | --- | --- |
| `inputImageName` | `2` (LoadImage) | `image` |
| `latentResolution` | `4` (EmptyLatentHunyuan3Dv2) | `resolution` |
| `seed`, `steps`, `cfg` | `7` (KSampler) | `seed`, `steps`, `cfg` |
| `octreeResolution` | `8` (VAEDecodeHunyuan3D) | `octree_resolution` |
| `voxelThreshold` | `9` (VoxelToMesh) | `threshold` |
| _(output)_ | `10` (SaveGLB) | `filename_prefix=hunyuan3d/ComfyUI` |

If your installation uses a different model filename, edit
`src/lib/comfyui/workflows/hunyuan3d-2.1.json` — change `ckpt_name` on node
`1` (ImageOnlyCheckpointLoader).

## Setting up the Vast.ai instance

1. **Pick a template** that already includes ComfyUI (search the Vast.ai
   templates marketplace), or roll your own based on `nvidia/cuda` and install
   ComfyUI manually. Make sure the ComfyUI version is recent enough to expose
   the built-in Hunyuan3D nodes (`SaveGLB`, `VoxelToMesh`, etc.) — any build
   from mid-2025 onward is fine.
2. **Open the ComfyUI port**: in the instance config, expose port `8188` (or
   whatever ComfyUI listens on) and note the public `host:port` Vast.ai assigns.
3. **Download the Hunyuan3D 2.1 model** — see [next section](#download-hunyuan3d-21-model-required).
4. **Restart ComfyUI** so it picks up the new model.
5. **Test**: hit `http://<host>:<port>/system_stats` and confirm you get JSON,
   then `http://<host>:<port>/object_info` and confirm `SaveGLB` is present.
6. Copy the instance id (numeric, visible in `vastai show instances` or the
   web UI URL) into `VAST_INSTANCE_ID`. Copy your API key into `VAST_API_KEY`.
7. Set `COMFYUI_URL=http://<host>:<port>`.

## Download Hunyuan3D 2.1 model (required)

ComfyUI doesn't ship with the Hunyuan3D weights. You need to download them
once onto the Vast.ai instance — they live on the instance's disk, so `stop`
+ `start` keeps them around (no re-download). `destroy` wipes the disk.

**Total size: ~8 GB.** A 50 GB instance disk is plenty.

| File | Place under | Size |
| --- | --- | --- |
| `hunyuan_3d_v2.1.safetensors` | `ComfyUI/models/checkpoints/` | ~8 GB |

Source: https://huggingface.co/Comfy-Org/hunyuan3D_2.1_repackaged

This is the **repackaged single-file build** that bundles the DiT, CLIP-Vision
encoder, and VAE into one checkpoint, so the workflow only needs one
`ImageOnlyCheckpointLoader` node.

### Download with the `hf` CLI

The new `hf` command replaces the deprecated `huggingface-cli` (huggingface_hub
>= 0.30). On Vast.ai's `vastai/comfy` images it ships pre-installed; on plain
images run `pip install -U "huggingface_hub[cli]"`.

```bash
cd ~/ComfyUI

hf download Comfy-Org/hunyuan3D_2.1_repackaged \
  split_files/checkpoints/hunyuan_3d_v2.1.safetensors \
  --local-dir models/checkpoints

# Flatten the split_files/ subdir hf creates so ComfyUI sees the file:
if [ -d "models/checkpoints/split_files/checkpoints" ]; then
  mv models/checkpoints/split_files/checkpoints/*.safetensors models/checkpoints/
  rm -rf models/checkpoints/split_files
fi
```

> The legacy `huggingface-cli download ... --local-dir-use-symlinks False`
> form prints a deprecation warning and exits without downloading on recent
> versions. Use `hf download` instead — it never symlinks by default.

### Verify the layout

```
~/ComfyUI/models/
└── checkpoints/hunyuan_3d_v2.1.safetensors
```

If the filename or path differs, update node `1`'s `ckpt_name` in
`src/lib/comfyui/workflows/hunyuan3d-2.1.json`.

### About the output

- Output format: `.glb` (glTF binary) — single file, includes mesh + textures,
  rendered in the UI via Google's `<model-viewer>` web component.
- ComfyUI writes the file to `ComfyUI/output/hunyuan3d/ComfyUI_<N>_.glb`; the
  worker fetches it via `/view` and uploads it to R2/S3.
- Expected inference time on an RTX 4090: **~1–3 minutes per job** (mostly
  KSampler steps + VAE decode + voxel→mesh).
- VRAM footprint: ~10 GB for shape-only at default `latent_resolution=3072`,
  `octree_resolution=256`. Increase either for higher quality at the cost of
  VRAM and time.

### Tuning quality vs speed

| Setting | Faster / lighter | Higher quality |
| --- | --- | --- |
| `latentResolution` | 1024–2048 | 3072–4096 |
| `octreeResolution` | 128 | 256–384 |
| `voxelThreshold` | 0.5 | 0.6 (default) |
| `steps` | 20 | 30–40 |
| `cfg` | 3 | 5 (default) |

## Cron / external idle watcher

If you can't keep the worker running 24/7 (e.g. Next.js on Vercel), set up an
external cron:

```
*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/idle-watcher
```

Or for Vercel Cron, add to `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/idle-watcher?secret=YOUR_CRON_SECRET", "schedule": "*/5 * * * *" }]
}
```

## Cost notes

- Default config keeps a single Vast.ai instance and stops it after **10 min**
  idle. Storage on Vast.ai costs while stopped (~$0.10–0.30/GB/month) but the
  GPU bill stops.
- For zero idle cost, you can switch to "destroy + recreate", but cold starts
  go from ~30s (start a stopped instance) to ~5–10 min (provision new instance
  + download model).
- Compared to a 27-minute WAN 2.2 video job at ~$0.40/hr, a 2-minute Hunyuan3D
  job is roughly **13× cheaper per generation** on the same instance.

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Prisma + SQLite (single-file DB)
- AWS SDK v3 for S3-compatible storage (R2/S3)
- WebSocket client (`ws`) for ComfyUI realtime progress
- Google `<model-viewer>` web component for in-browser 3D preview
- `tsx` for the worker process

## License

MIT
