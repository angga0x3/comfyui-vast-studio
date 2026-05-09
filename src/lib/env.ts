import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev.db"),

  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_PUBLIC_URL: z.string().optional().default(""),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  VAST_API_KEY: z.string().optional().default(""),
  VAST_INSTANCE_ID: z.string().optional().default(""),
  VAST_API_URL: z.string().default("https://console.vast.ai/api/v0"),

  COMFYUI_URL: z.string().optional().default(""),
  COMFYUI_CLIENT_ID: z.string().default("comfyui-vast-studio"),

  GPU_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(10),
  GPU_AUTO_WAKE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GPU_BOOT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(600),

  BASIC_AUTH_PASSWORD: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  cached = parsed.data;
  return cached;
}

export function hasStorageConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export function hasVastConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.VAST_API_KEY && env.VAST_INSTANCE_ID);
}

export function hasComfyConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.COMFYUI_URL);
}
