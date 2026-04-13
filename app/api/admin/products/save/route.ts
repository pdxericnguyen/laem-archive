import { setStock } from "@/lib/inventory";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product } from "@/lib/store";

type ProductPayload = {
  slug: string;
  originalSlug: string;
  returnStatusFilter: "all" | "live" | "sold-out" | "archived" | "hidden";
  title: string;
  subtitle: string;
  description: string;
  priceCents: number;
  stock: number;
  status: "live" | "archived" | "hidden";
  autoArchiveOnZero: boolean;
  images: string[];
  materials: string;
  dimensions: string;
  care: string;
  shippingReturns: string;
};

function normalizeStatus(value: unknown): ProductPayload["status"] | null {
  return value === "live" || value === "archived" || value === "hidden" ? value : null;
}

function normalizeReturnStatusFilter(value: unknown): ProductPayload["returnStatusFilter"] {
  return value === "live" || value === "sold-out" || value === "archived" || value === "hidden" ? value : "all";
}

function getLegacyStatus(published: boolean, archived: boolean): ProductPayload["status"] {
  if (!published) {
    return "hidden";
  }
  return archived ? "archived" : "live";
}

function parseBoolean(value: FormDataEntryValue | null | undefined) {
  if (!value) {
    return false;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value === "on" || value === "true" || value === "1";
}

function parseNumber(value: FormDataEntryValue | null | undefined) {
  if (!value) {
    return 0;
  }
  const num = typeof value === "string" ? Number(value) : Number(value.toString());
  return Number.isFinite(num) ? num : 0;
}

function parsePriceToCents(value: unknown) {
  const raw = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.round(raw * 100));
}

function parsePriceFromBody(body: Record<string, unknown>) {
  if (body.price !== undefined) {
    return parsePriceToCents(body.price);
  }
  const legacyValue =
    typeof body.priceCents === "number" ? body.priceCents : Number(body.priceCents ?? 0);
  return Number.isFinite(legacyValue) ? Math.max(0, Math.floor(legacyValue)) : 0;
}

function clampToNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function parseImages(value: FormDataEntryValue | null | undefined) {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("content-type")?.includes("application/json");
}

function buildRedirectUrl(
  request: Request,
  payload: ProductPayload,
  params?: {
    saveError?: "slug_locked";
    saveSlug?: string;
  }
) {
  const redirectUrl = new URL("/admin/products", request.url);
  if (payload.returnStatusFilter !== "all") {
    redirectUrl.searchParams.set("status", payload.returnStatusFilter);
  }
  if (params?.saveError) {
    redirectUrl.searchParams.set("saveError", params.saveError);
  }
  if (params?.saveSlug) {
    redirectUrl.searchParams.set("saveSlug", params.saveSlug);
  }
  return redirectUrl;
}

async function getPayload(request: Request): Promise<ProductPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return null;
    }

    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!slug || !title) {
      return null;
    }

    return {
      slug,
      originalSlug:
        typeof body.originalSlug === "string" && body.originalSlug.trim()
          ? body.originalSlug.trim()
          : slug,
      returnStatusFilter: normalizeReturnStatusFilter(body.returnStatusFilter),
      title,
      subtitle: typeof body.subtitle === "string" ? body.subtitle : "",
      description:
        typeof body.description === "string"
          ? body.description
          : typeof body.subtitle === "string"
            ? body.subtitle
            : "",
      priceCents: parsePriceFromBody(body),
      stock: typeof body.stock === "number" ? body.stock : Number(body.stock ?? 0),
      status:
        normalizeStatus(body.status) || getLegacyStatus(Boolean(body.published), Boolean(body.archived)),
      autoArchiveOnZero: Boolean(body.autoArchiveOnZero),
      images: Array.isArray(body.images)
        ? body.images.filter((item) => typeof item === "string")
        : [],
      materials: typeof body.materials === "string" ? body.materials : "",
      dimensions: typeof body.dimensions === "string" ? body.dimensions : "",
      care: typeof body.care === "string" ? body.care : "",
      shippingReturns: typeof body.shippingReturns === "string" ? body.shippingReturns : ""
    };
  }

  const formData = await request.formData();
  const slug = formData.get("slug");
  const title = formData.get("title");
  if (typeof slug !== "string" || typeof title !== "string") {
    return null;
  }
  const trimmedSlug = slug.trim();
  const trimmedTitle = title.trim();
  if (!trimmedSlug || !trimmedTitle) {
    return null;
  }

  return {
    slug: trimmedSlug,
    originalSlug:
      typeof formData.get("originalSlug") === "string" && String(formData.get("originalSlug")).trim()
        ? String(formData.get("originalSlug")).trim()
        : trimmedSlug,
    returnStatusFilter: normalizeReturnStatusFilter(formData.get("returnStatusFilter")),
    title: trimmedTitle,
    subtitle: typeof formData.get("subtitle") === "string" ? String(formData.get("subtitle")) : "",
    description:
      typeof formData.get("description") === "string"
        ? String(formData.get("description"))
        : typeof formData.get("subtitle") === "string"
          ? String(formData.get("subtitle"))
          : "",
    priceCents: parsePriceToCents(formData.get("price") ?? formData.get("priceCents")),
    stock: parseNumber(formData.get("stock")),
    status:
      normalizeStatus(formData.get("status")) ||
      getLegacyStatus(parseBoolean(formData.get("published")), parseBoolean(formData.get("archived"))),
    autoArchiveOnZero: parseBoolean(formData.get("autoArchiveOnZero")),
    images: parseImages(formData.get("images")),
    materials: typeof formData.get("materials") === "string" ? String(formData.get("materials")) : "",
    dimensions: typeof formData.get("dimensions") === "string" ? String(formData.get("dimensions")) : "",
    care: typeof formData.get("care") === "string" ? String(formData.get("care")) : "",
    shippingReturns:
      typeof formData.get("shippingReturns") === "string" ? String(formData.get("shippingReturns")) : ""
  };
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!hasKvEnv()) {
    return new Response("Missing KV configuration", { status: 500 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return new Response("Invalid payload", { status: 400 });
  }

  const normalizedStock = clampToNonNegativeInt(payload.stock);
  const normalizedPrice = clampToNonNegativeInt(payload.priceCents);
  const published = payload.status !== "hidden";
  const archived =
    payload.status === "archived" || (payload.status === "live" && payload.autoArchiveOnZero && normalizedStock <= 0);

  const product: Product = {
    slug: payload.slug,
    title: payload.title,
    subtitle: payload.subtitle,
    description: payload.description,
    priceCents: normalizedPrice,
    stock: normalizedStock,
    archived,
    published,
    autoArchiveOnZero: payload.autoArchiveOnZero,
    images: payload.images,
    materials: payload.materials,
    dimensions: payload.dimensions,
    care: payload.care,
    shippingReturns: payload.shippingReturns
  };

  const existing = await kv.get<Product[]>(key.products);
  const products = Array.isArray(existing) ? existing : [];
  const originalSlug = payload.originalSlug || product.slug;
  const index = products.findIndex((item) => item.slug === originalSlug);
  const existingProduct = index >= 0 ? products[index] : null;
  const isOriginalLive = Boolean(existingProduct?.published) && !Boolean(existingProduct?.archived);
  if (isOriginalLive && originalSlug !== product.slug) {
    const message = "Live listings must be hidden or archived before their slug can be changed.";
    if (wantsJsonResponse(request)) {
      return Response.json(
        {
          ok: false,
          error: message,
          code: "slug_locked"
        },
        { status: 409 }
      );
    }

    return Response.redirect(
      buildRedirectUrl(request, payload, {
        saveError: "slug_locked",
        saveSlug: originalSlug
      }),
      303
    );
  }

  if (index >= 0) {
    products[index] = product;
  } else {
    products.unshift(product);
  }

  await kv.set(key.products, products);
  await kv.set(key.product(product.slug), product);
  await setStock(product.slug, product.stock);
  await kv.set(key.published(product.slug), product.published);
  await kv.set(key.archived(product.slug), product.archived);
  if (originalSlug !== product.slug) {
    await kv.del(key.product(originalSlug));
    await kv.del(key.stock(originalSlug));
    await kv.del(key.published(originalSlug));
    await kv.del(key.archived(originalSlug));
  }
  await kv.del(key.productsIndex);
  if (products.length > 0) {
    await kv.rpush(
      key.productsIndex,
      ...products.map((item) => item.slug)
    );
  }

  const wantsJson = wantsJsonResponse(request);
  if (wantsJson) {
    return Response.json({ ok: true, product });
  }

  return Response.redirect(buildRedirectUrl(request, payload), 303);
}
