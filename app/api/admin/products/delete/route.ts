import { deleteBlobIfUnreferenced } from "@/lib/blob-assets";
import { deleteStockForSlug, summarizeReservationHoldsForSlugs } from "@/lib/inventory";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product, ProductCategory } from "@/lib/store";

type ProductCategoryFilter = "all" | ProductCategory | "uncategorized";

type DeletePayload = {
  slug: string;
  confirmSlug: string;
  returnStatusFilter: "all" | "live" | "sold-out" | "archived" | "hidden";
  returnCategoryFilter: ProductCategoryFilter;
  returnQuery: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReturnStatusFilter(value: unknown): DeletePayload["returnStatusFilter"] {
  return value === "live" || value === "sold-out" || value === "archived" || value === "hidden" ? value : "all";
}

function normalizeReturnCategoryFilter(value: unknown): ProductCategoryFilter {
  return value === "clothing" || value === "accessories" || value === "jewelry" || value === "uncategorized"
    ? value
    : "all";
}

function normalizeReturnQuery(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
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
    deleteReservedStock?: number;
    deleteActiveCheckoutCount?: number;
    deleteLastExpiresAt?: number;
  }
) {
  const redirectUrl = new URL("/admin/products", request.url);
  if (payload.returnStatusFilter !== "all") {
    redirectUrl.searchParams.set("status", payload.returnStatusFilter);
  }
  if (payload.returnCategoryFilter !== "all") {
    redirectUrl.searchParams.set("category", payload.returnCategoryFilter);
  }
  if (payload.returnQuery) {
    redirectUrl.searchParams.set("q", payload.returnQuery);
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
  if (params?.deleteReservedStock) {
    redirectUrl.searchParams.set("deleteReservedStock", String(params.deleteReservedStock));
  }
  if (params?.deleteActiveCheckoutCount) {
    redirectUrl.searchParams.set("deleteActiveCheckoutCount", String(params.deleteActiveCheckoutCount));
  }
  if (params?.deleteLastExpiresAt) {
    redirectUrl.searchParams.set("deleteLastExpiresAt", String(params.deleteLastExpiresAt));
  }
  return redirectUrl;
}

function errorResponse(
  request: Request,
  payload: DeletePayload,
  status: number,
  deleteError: "live" | "reserved",
  message: string,
  details?: {
    reservedStock?: number;
    activeCheckoutCount?: number;
    lastExpiresAt?: number;
  }
) {
  if (wantsJsonResponse(request)) {
    return Response.json(
      {
        ok: false,
        error: message,
        code: deleteError,
        details
      },
      { status }
    );
  }

  return Response.redirect(
    buildRedirectUrl(request, payload, {
      deleteError,
      deleteSlug: payload.slug,
      deleteReservedStock: details?.reservedStock,
      deleteActiveCheckoutCount: details?.activeCheckoutCount,
      deleteLastExpiresAt: details?.lastExpiresAt
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
    const returnCategoryFilter = normalizeReturnCategoryFilter(body.returnCategoryFilter);
    const returnQuery = normalizeReturnQuery(body.returnQuery);
    if (!slug || !confirmSlug) {
      return null;
    }
    return { slug, confirmSlug, returnStatusFilter, returnCategoryFilter, returnQuery };
  }

  const formData = await request.formData();
  const slug = asString(formData.get("slug"));
  const confirmSlug = asString(formData.get("confirmSlug"));
  const returnStatusFilter = normalizeReturnStatusFilter(formData.get("returnStatusFilter"));
  const returnCategoryFilter = normalizeReturnCategoryFilter(formData.get("returnCategoryFilter"));
  const returnQuery = normalizeReturnQuery(formData.get("returnQuery"));
  if (!slug || !confirmSlug) {
    return null;
  }
  return { slug, confirmSlug, returnStatusFilter, returnCategoryFilter, returnQuery };
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

  const holdSummaries = await summarizeReservationHoldsForSlugs([payload.slug]);
  const holdSummary = holdSummaries[payload.slug];
  const reservedStock = holdSummary?.reservedStock || 0;
  if (reservedStock > 0) {
    return errorResponse(
      request,
      payload,
      409,
      "reserved",
      "This listing still has inventory reserved by an in-progress checkout and cannot be deleted until that checkout completes or expires.",
      {
        reservedStock,
        activeCheckoutCount: holdSummary?.activeCheckoutCount,
        lastExpiresAt: holdSummary?.lastExpiresAt
      }
    );
  }

  const nextProducts = products.filter((item) => item.slug !== payload.slug);
  await deleteStockForSlug(payload.slug);
  await kv.set(key.products, nextProducts);
  await kv.del(key.product(payload.slug));
  await kv.del(key.published(payload.slug));
  await kv.del(key.archived(payload.slug));
  await rebuildProductsIndex(nextProducts);

  const imageUrls = getProductImages(product);
  if (imageUrls.length > 0) {
    try {
      await Promise.all(
        imageUrls.map((imageUrl) =>
          deleteBlobIfUnreferenced(imageUrl, {
            excludeProductSlug: payload.slug
          })
        )
      );
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
