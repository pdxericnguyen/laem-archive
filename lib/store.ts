import { hasKvEnv, key, kv } from "@/lib/kv";

export type Product = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  priceCents: number;
  stock: number;
  archived: boolean;
  published: boolean;
  images: string[];
  materials: string;
  dimensions: string;
  care: string;
  shippingReturns: string;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeProduct(input: unknown): Product | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const row = input as Record<string, unknown>;
  const slug = asString(row.slug).trim();
  const title = asString(row.title).trim();
  if (!slug || !title) {
    return null;
  }

  const subtitle = asString(row.subtitle);
  const description = asString(row.description, subtitle);

  return {
    slug,
    title,
    subtitle,
    description,
    priceCents: Math.max(0, Math.floor(asNumber(row.priceCents))),
    stock: Math.max(0, Math.floor(asNumber(row.stock))),
    archived: asBoolean(row.archived),
    published: asBoolean(row.published),
    images: asStringArray(row.images),
    materials: asString(row.materials),
    dimensions: asString(row.dimensions),
    care: asString(row.care),
    shippingReturns: asString(row.shippingReturns)
  };
}

async function getAllProducts(): Promise<Product[]> {
  if (!hasKvEnv()) {
    return [];
  }
  try {
    const products = await kv.get<unknown[]>(key.products);
    if (!Array.isArray(products)) {
      return [];
    }
    return products
      .map((row) => normalizeProduct(row))
      .filter((row): row is Product => Boolean(row));
  } catch {
    return [];
  }
}

export async function getProduct(slug: string) {
  if (hasKvEnv()) {
    try {
      const direct = await kv.get<unknown>(key.product(slug));
      const normalized = normalizeProduct(direct);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall through to list lookup.
    }
  }

  const products = await getAllProducts();
  return products.find((product) => product.slug === slug) || null;
}

export async function getShopItems() {
  const products = await getAllProducts();
  return products.filter((product) => product.published && !product.archived);
}

export async function getArchiveItems() {
  const products = await getAllProducts();
  return products.filter(
    (product) => product.archived || (product.published && product.stock <= 0)
  );
}
