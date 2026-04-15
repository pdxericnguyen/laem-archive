import { del as deleteBlob } from "@vercel/blob";

import { reconcileReservedStockForSlugs } from "@/lib/inventory";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product } from "@/lib/store";

type DeletePayload = {
  slug: string;
  confirmSlug: string;
  returnStatusFilter: "all" | "live" | "sold-out" | "archived" | "hidden";
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReturnStatusFilter(value: unknown): DeletePayload["returnStatusFilter"] {
  return value === "live" || value === "sold-out" || value === "archived" || value === "hidden" ? value : "all";
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("content-type")?.includes("application/json");
}

function buildRedirectUrl(
  request: Request,
  payload: DeletePayload,
  params?: {
    deleted?: string;
    deleteError?: "live" | "reserved";
    deleteSlug?: string;
  }
) {
  const redirectUrl = new URL("/admin/products", request.url);
  if (payload.returnStatusFilter !== "all") {
    redirectUrl.searchParams.set("status", payload.returnStatusFilter);
  }
  if (params?.deleted) {
    redirectUrl.searchParams.set("deleted", params.deleted);
  }
  if (params?.deleteError) {
    redirectUrl.searchParams.set("deleteError", params.deleteError);
  }
  if (params?.deleteSlug) {
    redirectUrl.searchParams.set("deleteSlug", params.deleteSlug);
  }
  return redirectUrl;
}

function errorResponse(
  request: Request,
  payload: DeletePayload,
  status: number,
  deleteError: "live" | "reserved",
  message: string
) {
  if (wantsJsonResponse(request)) {
    return Response.json(
      {
        ok: false,
        error: message,
        code: deleteError
      },
      { status }
    );
  }

  return Response.redirect(
    buildRedirectUrl(request, payload, {
      deleteError,
      deleteSlug: payload.slug
    }),
    303
  );
}

async function getPayload(request: Request): Promise<DeletePayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const slug = asString(body.slug);
    const confirmSlug = asString(body.confirmSlug);
    const returnStatusFilter = normalizeReturnStatusFilter(body.returnStatusFilter);
    if (!slug || !confirmSlug) {
      return null;
    }
    return { slug, confirmSlug, returnStatusFilter };
  }

  const formData = await request.formData();
  const slug = asString(formData.get("slug"));
  const confirmSlug = asString(formData.get("confirmSlug"));
  const returnStatusFilter = normalizeReturnStatusFilter(formData.get("returnStatusFilter"));
  if (!slug || !confirmSlug) {
    return null;
  }
  return { slug, confirmSlug, returnStatusFilter };
}

function getProductImages(product: Product | null) {
  if (!product || !Array.isArray(product.images)) {
    return [];
  }
  return product.images.filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function rebuildProductsIndex(products: Product[]) {
  await kv.del(key.productsIndex);
  if (products.length > 0) {
    await kv.rpush(
      key.productsIndex,
      ...products.map((product) => product.slug)
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasKvEnv()) {
    return new Response("Missing Redis configuration", { status: 500 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return new Response("Invalid payload", { status: 400 });
  }

  if (payload.confirmSlug !== payload.slug) {
    return new Response("Confirmation slug does not match.", { status: 400 });
  }

  const existing = await kv.get<Product[]>(key.products);
  const products = Array.isArray(existing) ? existing : [];
  const direct = await kv.get<Product>(key.product(payload.slug));
  const listMatch = products.find((product) => product.slug === payload.slug) || null;
  const product = direct || listMatch;

  if (!product) {
    return new Response("Product not found", { status: 404 });
  }

  const isLive = product.published && !product.archived;
  if (isLive) {
    return errorResponse(
      request,
      payload,
      409,
      "live",
      "Live listings must be hidden or archived before they can be permanently deleted."
    );
  }

  const reservedBySlug = await reconcileReservedStockForSlugs([payload.slug]);
  const reservedStock = reservedBySlug[payload.slug] || 0;
  if (reservedStock > 0) {
    return errorResponse(
      request,
      payload,
      409,
      "reserved",
      "This listing still has inventory reserved by an in-progress checkout and cannot be deleted until that checkout completes or expires."
    );
  }

  const nextProducts = products.filter((item) => item.slug !== payload.slug);
  await kv.set(key.products, nextProducts);
  await kv.del(key.product(payload.slug));
  await kv.del(key.stock(payload.slug));
  await kv.del(key.published(payload.slug));
  await kv.del(key.archived(payload.slug));
  await rebuildProductsIndex(nextProducts);

  const imageUrls = getProductImages(product);
  if (imageUrls.length > 0) {
    try {
      await deleteBlob(imageUrls);
    } catch (error) {
      console.error("Blob cleanup failed for deleted product", {
        slug: payload.slug,
        error
      });
    }
  }

  const wantsJson = wantsJsonResponse(request);
  if (wantsJson) {
    return Response.json({ ok: true, slug: payload.slug });
  }

  return Response.redirect(
    buildRedirectUrl(request, payload, {
      deleted: payload.slug
    }),
    303
  );
}
