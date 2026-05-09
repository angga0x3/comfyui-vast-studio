import { S3Client } from "@aws-sdk/client-s3";
import { getEnv, hasStorageConfigured } from "../env";

let cached: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cached) return cached;
  if (!hasStorageConfigured()) {
    throw new Error(
      "S3/R2 storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
    );
  }
  const env = getEnv();
  cached = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return cached;
}
