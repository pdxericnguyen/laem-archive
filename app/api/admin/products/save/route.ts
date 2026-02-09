import { setStock } from "@/lib/inventory";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product } from "@/lib/store";

type ProductPayload = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  priceCents: number;
  stock: number;
  archived: boolean;
  published: boolean;
  autoArchiveOnZero: boolean;
  images: string[];
  materials: string;
  dimensions: string;
  care: string;
  shippingReturns: string;
};

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
      title,
      subtitle: typeof body.subtitle === "string" ? body.subtitle : "",
      description:
        typeof body.description === "string"
          ? body.description
          : typeof body.subtitle === "string"
            ? body.subtitle
            : "",
      priceCents: typeof body.priceCents === "number" ? body.priceCents : Number(body.priceCents ?? 0),
      stock: typeof body.stock === "number" ? body.stock : Number(body.stock ?? 0),
      archived: Boolean(body.archived),
      published: Boolean(body.published),
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
    title: trimmedTitle,
    subtitle: typeof formData.get("subtitle") === "string" ? String(formData.get("subtitle")) : "",
    description:
      typeof formData.get("description") === "string"
        ? String(formData.get("description"))
        : typeof formData.get("subtitle") === "string"
          ? String(formData.get("subtitle"))
          : "",
    priceCents: parseNumber(formData.get("priceCents")),
    stock: parseNumber(formData.get("stock")),
    archived: parseBoolean(formData.get("archived")),
    published: parseBoolean(formData.get("published")),
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
  const archived = payload.autoArchiveOnZero && normalizedStock <= 0 ? true : payload.archived;

  const product: Product = {
    slug: payload.slug,
    title: payload.title,
    subtitle: payload.subtitle,
    description: payload.description,
    priceCents: normalizedPrice,
    stock: normalizedStock,
    archived,
    published: payload.published,
    autoArchiveOnZero: payload.autoArchiveOnZero,
    images: payload.images,
    materials: payload.materials,
    dimensions: payload.dimensions,
    care: payload.care,
    shippingReturns: payload.shippingReturns
  };

  const existing = await kv.get<Product[]>(key.products);
  const products = Array.isArray(existing) ? existing : [];
  const index = products.findIndex((item) => item.slug === product.slug);
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
  await kv.del(key.productsIndex);
  if (products.length > 0) {
    await kv.rpush(
      key.productsIndex,
      ...products.map((item) => item.slug)
    );
  }

  const wantsJson = request.headers.get("content-type")?.includes("application/json");
  if (wantsJson) {
    return Response.json({ ok: true, product });
  }

  const redirectUrl = new URL("/admin/products", request.url);
  return Response.redirect(redirectUrl, 303);
}
