import { NextResponse } from "next/server";

import { setStock } from "@/lib/inventory";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product } from "@/lib/store";

type BulkStockPayload = {
  updates?: Array<{ slug?: string; stock?: number }>;
};

function sanitizeUpdates(payload: BulkStockPayload) {
  if (!Array.isArray(payload.updates)) {
    return [];
  }

  return payload.updates
    .map((item) => {
      const slug = typeof item.slug === "string" ? item.slug.trim() : "";
      const stockValue = typeof item.stock === "number" ? item.stock : Number(item.stock ?? 0);
      if (!slug || !Number.isFinite(stockValue)) {
        return null;
      }

      return {
        slug,
        stock: Math.max(0, Math.floor(stockValue))
      };
    })
    .filter((item): item is { slug: string; stock: number } => Boolean(item));
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

  const payload = (await request.json().catch(() => null)) as BulkStockPayload | null;
  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const updates = sanitizeUpdates(payload);
  if (updates.length === 0) {
    return new Response("No valid stock updates", { status: 400 });
  }

  const products = await kv.get<Product[]>(key.products);
  const currentProducts = Array.isArray(products) ? products : [];
  const indexBySlug = new Map(currentProducts.map((product, index) => [product.slug, index]));

  for (const update of updates) {
    await setStock(update.slug, update.stock);

    const arrayIndex = indexBySlug.get(update.slug);
    const arrayProduct = typeof arrayIndex === "number" ? currentProducts[arrayIndex] : null;
    const directProduct = await kv.get<Product>(key.product(update.slug));
    const merged = directProduct ?? arrayProduct;

    if (merged) {
      const nextProduct = { ...merged, stock: update.stock };
      await kv.set(key.product(update.slug), nextProduct);
      if (typeof arrayIndex === "number") {
        currentProducts[arrayIndex] = nextProduct;
      }
    }
  }

  if (currentProducts.length > 0) {
    await kv.set(key.products, currentProducts);
  }

  return NextResponse.json({
    ok: true,
    updated: updates.length,
    rows: updates
  });
}
