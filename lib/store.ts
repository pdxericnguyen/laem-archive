import { hasKvEnv, key, kv } from "@/lib/kv";

export type ProductCategory = "clothing" | "accessories" | "jewelry";

export type Product = {
  slug: string;
  inventoryItemId?: string;
  title: string;
  subtitle: string;
  description: string;
  category?: ProductCategory;
  priceCents: number;
  archived: boolean;
  autoArchivedAt?: number;
  published: boolean;
  autoArchiveOnZero: boolean;
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

function asCategory(value: unknown): ProductCategory | undefined {
  if (value === "clothing" || value === "accessories" || value === "jewelry") {
    return value;
  }
  return undefined;
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
  const inventoryItemId = asString(row.inventoryItemId).trim();
  const autoArchivedAt = Math.max(0, Math.floor(asNumber(row.autoArchivedAt)));
  const category = asCategory(row.category);

  const product: Product = {
    slug,
    inventoryItemId: inventoryItemId || undefined,
    title,
    subtitle,
    description,
    category,
    priceCents: Math.max(0, Math.floor(asNumber(row.priceCents))),
    archived: asBoolean(row.archived),
    published: asBoolean(row.published),
    autoArchiveOnZero: asBoolean(row.autoArchiveOnZero),
    images: asStringArray(row.images),
    materials: asString(row.materials),
    dimensions: asString(row.dimensions),
    care: asString(row.care),
    shippingReturns: asString(row.shippingReturns)
  };

  if (autoArchivedAt > 0) {
    product.autoArchivedAt = autoArchivedAt;
  }

  return product;
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
  return products.filter((product) => product.published && product.archived);
}
