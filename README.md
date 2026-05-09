# ComfyUI Vast Studio

Personal control panel for **image-to-video generation** with ComfyUI running on
a [Vast.ai](https://vast.ai/) GPU instance.

- Upload an image, pick a workflow preset (default **WAN 2.2 I2V**), enter a prompt → get a video.
- Auto **start the GPU** when there's a job to run, auto **stop on idle** to save money.
- Outputs are stored on **Cloudflare R2 / AWS S3** so you can access them from anywhere.
- Single-user, optional Basic Auth password to protect the UI.

> Designed for personal use. SQLite + a single background worker, no Redis needed.

## Architecture

```
[Browser]
    │  upload image, submit job, watch progress
    ▼
[Next.js app  (web + API routes)] ◄── SQLite (jobs, assets, gpu state)
    │  enqueues Job rows                 R2 / S3 (input image + output video)
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
- A Vast.ai account with one running GPU instance pre-configured with ComfyUI:
  - The instance must expose ComfyUI's HTTP port (default 8188) publicly.
  - Vast.ai shows the mapped port like `host:port` in the **"Open Ports"** section.
  - Required ComfyUI models for WAN 2.2 I2V (place under `ComfyUI/models/`):
    - `unet/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`
    - `clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors`
    - `vae/wan_2.1_vae.safetensors`
    - `clip_vision/clip_vision_h.safetensors`
    - VHS-VideoCombine custom node installed
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
   `params.prompt`, etc.
4. The frontend will list it automatically via `/api/presets`.

### How the WAN 2.2 I2V template injects parameters

| Param | Node id | Inputs key |
| --- | --- | --- |
| `inputImageName` | `14` (LoadImage) | `image` |
| `prompt` | `6` (CLIPTextEncode positive) | `text` |
| `negativePrompt` | `7` (CLIPTextEncode negative) | `text` |
| `seed`, `steps`, `cfg` | `3` (KSampler) | `seed`, `steps`, `cfg` |
| `width`, `height`, `length` | `12` (WanImageToVideo) | `width`, `height`, `length` |
| `fps` | `9` (VHS_VideoCombine) | `frame_rate` |

If your installation uses different model filenames, edit
`src/lib/comfyui/workflows/wan22-i2v.json` (UNETLoader, CLIPLoader, VAELoader,
CLIPVisionLoader nodes).

## Setting up the Vast.ai instance

1. **Pick a template** that already includes ComfyUI (search the Vast.ai
   templates marketplace), or roll your own based on `nvidia/cuda` and install
   ComfyUI + custom nodes manually.
2. **Open the ComfyUI port**: in the instance config, expose port `8188` (or
   whatever ComfyUI listens on) and note the public `host:port` Vast.ai assigns.
3. **Pre-load models**: SSH into the instance and download WAN 2.2 + CLIP +
   VAE models into `ComfyUI/models/` (see Prerequisites). Pre-loading saves
   minutes on every cold start.
4. **Test**: hit `http://<host>:<port>/system_stats` and confirm you get JSON.
5. Copy the instance id (numeric, visible in `vastai show instances` or the
   web UI URL) into `VAST_INSTANCE_ID`. Copy your API key into `VAST_API_KEY`.
6. Set `COMFYUI_URL=http://<host>:<port>`.

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
  + download models).

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Prisma + SQLite (single-file DB)
- AWS SDK v3 for S3-compatible storage (R2/S3)
- WebSocket client (`ws`) for ComfyUI realtime progress
- `tsx` for the worker process

## License

MIT
