import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "Image is too large (max 10MB)" }, { status: 400 });
  }

  const safeName = sanitizeFileName(file.name || "image");
  const filePath = `products/${Date.now()}-${safeName || "image"}`;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const blob = await put(filePath, file, {
      access: "public",
      token: token || undefined
    });

    return NextResponse.json({
      ok: true,
      url: blob.url,
      pathname: blob.pathname
    });
  } catch (error) {
    console.error("Blob upload failed", error);
    return NextResponse.json({ ok: false, error: "Blob upload failed" }, { status: 500 });
  }
}
