import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "./s3";
import { getEnv } from "../env";

export interface UploadResult {
  bucket: string;
  key: string;
  size: number;
  mimeType: string;
  publicUrl: string | null;
}

export async function uploadBuffer(args: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<UploadResult> {
  const env = getEnv();
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  const publicUrl = env.S3_PUBLIC_URL
    ? `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${args.key}`
    : null;
  return {
    bucket: env.S3_BUCKET,
    key: args.key,
    size: args.body.byteLength,
    mimeType: args.contentType,
    publicUrl,
  };
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 60 * 60,
): Promise<string> {
  const env = getEnv();
  const client = getS3Client();
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function resolveDownloadUrl(asset: {
  publicUrl?: string | null;
  bucket: string;
  key: string;
}): Promise<string> {
  if (asset.publicUrl) return asset.publicUrl;
  return getPresignedDownloadUrl(asset.key);
}

export function makeAssetKey(kind: string, id: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${kind}/${yyyy}/${mm}/${id}-${safe}`;
}
