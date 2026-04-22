import { NextResponse } from "next/server";

import { deleteBlobIfUnreferenced } from "@/lib/blob-assets";
import { hasKvEnv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!hasKvEnv()) {
    return NextResponse.json({ ok: false, error: "Missing KV configuration" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const url = asString(body?.url);
  const excludeProductSlug = asString(body?.excludeProductSlug) || undefined;
  const excludeSiteVisualPlacement = asString(body?.excludeSiteVisualPlacement) || undefined;
  if (!url) {
    return NextResponse.json({ ok: false, error: "Missing image URL" }, { status: 400 });
  }

  try {
    const result = await deleteBlobIfUnreferenced(url, {
      excludeProductSlug,
      excludeSiteVisualPlacement
    });

    if (!result.ok && result.reason === "referenced") {
      return NextResponse.json(
        {
          ok: false,
          error: "Image is still used elsewhere.",
          code: "referenced",
          references: result.references
        },
        { status: 409 }
      );
    }

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Unable to delete image." }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deleted: true
    });
  } catch (error) {
    console.error("Blob delete failed", {
      url,
      error
    });
    return NextResponse.json({ ok: false, error: "Blob delete failed" }, { status: 500 });
  }
}
