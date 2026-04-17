import { NextResponse } from "next/server";

import { hasKvEnv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import {
  isSiteVisualPlacement,
  normalizeLinkHref,
  saveSiteVisual
} from "@/lib/site-visuals";

type VisualPayload = {
  placement: string;
  imageUrl: string;
  altText: string;
  eyebrow: string;
  headline: string;
  body: string;
  linkHref: string;
  linkLabel: string;
  published: boolean;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asSingleLine(value: unknown) {
  return asString(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value === "on" || value === "true" || value === "1";
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("content-type")?.includes("application/json");
}

function buildRedirectUrl(request: Request, params: Record<string, string>) {
  const url = new URL("/admin/visuals", request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function getPayload(request: Request): Promise<VisualPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return null;
    }
    return {
      placement: asString(body.placement),
      imageUrl: asSingleLine(body.imageUrl),
      altText: asString(body.altText),
      eyebrow: asString(body.eyebrow),
      headline: asString(body.headline),
      body: asString(body.body),
      linkHref: normalizeLinkHref(body.linkHref),
      linkLabel: asString(body.linkLabel),
      published: parseBoolean(body.published)
    };
  }

  const formData = await request.formData();
  return {
    placement: asString(formData.get("placement")),
    imageUrl: asSingleLine(formData.get("imageUrl")),
    altText: asString(formData.get("altText")),
    eyebrow: asString(formData.get("eyebrow")),
    headline: asString(formData.get("headline")),
    body: asString(formData.get("body")),
    linkHref: normalizeLinkHref(formData.get("linkHref")),
    linkLabel: asString(formData.get("linkLabel")),
    published: parseBoolean(formData.get("published"))
  };
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

  const payload = await getPayload(request);
  if (!payload || !isSiteVisualPlacement(payload.placement)) {
    return new Response("Invalid visual placement", { status: 400 });
  }

  if (payload.published && !payload.imageUrl) {
    const message = "Add an image before publishing this visual.";
    if (wantsJsonResponse(request)) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    return NextResponse.redirect(
      buildRedirectUrl(request, {
        visualError: "missing_image",
        placement: payload.placement
      }),
      303
    );
  }

  const visual = await saveSiteVisual({
    placement: payload.placement,
    imageUrl: payload.imageUrl,
    altText: payload.altText,
    eyebrow: payload.eyebrow,
    headline: payload.headline,
    body: payload.body,
    linkHref: payload.linkHref,
    linkLabel: payload.linkLabel,
    published: payload.published
  });

  if (wantsJsonResponse(request)) {
    return NextResponse.json({ ok: true, visual });
  }

  return NextResponse.redirect(
    buildRedirectUrl(request, {
      saved: visual.placement
    }),
    303
  );
}
