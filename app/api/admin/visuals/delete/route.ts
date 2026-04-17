import { NextResponse } from "next/server";

import { hasKvEnv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import { deleteSiteVisual, isSiteVisualPlacement } from "@/lib/site-visuals";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("content-type")?.includes("application/json");
}

async function getPlacement(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return asString(body?.placement);
  }

  const formData = await request.formData();
  return asString(formData.get("placement"));
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!hasKvEnv()) {
    return new Response("Missing KV configuration", { status: 500 });
  }

  const placement = await getPlacement(request);
  if (!isSiteVisualPlacement(placement)) {
    return new Response("Invalid visual placement", { status: 400 });
  }

  await deleteSiteVisual(placement);

  if (wantsJsonResponse(request)) {
    return NextResponse.json({ ok: true, placement });
  }

  const redirectUrl = new URL("/admin/visuals", request.url);
  redirectUrl.searchParams.set("deleted", placement);
  return NextResponse.redirect(redirectUrl, 303);
}
