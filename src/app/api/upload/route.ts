import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { uploadBuffer, makeAssetKey } from "@/lib/storage";
import { hasStorageConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  if (!hasStorageConfigured()) {
    return NextResponse.json(
      { error: "Storage is not configured. Set S3_BUCKET and credentials." },
      { status: 503 },
    );
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported mime type: ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  const tempId = z.string().parse(crypto.randomUUID().replace(/-/g, "").slice(0, 12));
  const key = makeAssetKey("input", tempId, file.name || "image.png");
  const upload = await uploadBuffer({ key, body: buf, contentType: file.type });

  const asset = await prisma.asset.create({
    data: {
      kind: "input_image",
      bucket: upload.bucket,
      key: upload.key,
      mimeType: upload.mimeType,
      size: upload.size,
      publicUrl: upload.publicUrl,
    },
  });

  return NextResponse.json({
    id: asset.id,
    bucket: asset.bucket,
    key: asset.key,
    mimeType: asset.mimeType,
    size: asset.size,
    publicUrl: asset.publicUrl,
  });
}
