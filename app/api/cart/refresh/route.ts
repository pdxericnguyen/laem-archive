import {
  cleanupExpiredInventoryReservations,
  getAvailableStock,
  getProduct
} from "@/lib/inventory";

export const runtime = "nodejs";

type CartRefreshRequestItem = {
  slug: string;
  title: string;
  priceCents: number;
  image: string;
  stock: number;
  quantity: number;
};

type CartRefreshWarningKind = "price_changed" | "quantity_reduced" | "unavailable";

type CartRefreshWarning = {
  slug: string;
  kind: CartRefreshWarningKind;
  message: string;
};

function clampPositiveInt(value: unknown, fallback = 1) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function clampNonNegativeInt(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeRequestItems(input: unknown): CartRefreshRequestItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const items: CartRefreshRequestItem[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const item = row as Record<string, unknown>;
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const title = typeof item.title === "string" ? item.title : "";
    const image = typeof item.image === "string" ? item.image : "";
    const priceCents = clampNonNegativeInt(item.priceCents, 0);
    const stock = clampNonNegativeInt(item.stock, 0);
    const quantity = clampPositiveInt(item.quantity, 1);

    if (!slug || !title || !image) {
      continue;
    }

    items.push({
      slug,
      title,
      priceCents,
      image,
      stock,
      quantity
    });
  }

  return items;
}

function unavailableMessage(title: string) {
  return `${title} is no longer available for checkout. Remove it from your cart to continue.`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const items = normalizeRequestItems(body?.items);

  if (items.length === 0) {
    return Response.json({ ok: true, items: [], warnings: [] });
  }

  await cleanupExpiredInventoryReservations();

  const warnings: CartRefreshWarning[] = [];
  const refreshedItems = await Promise.all(
    items.map(async (item) => {
      const product = await getProduct(item.slug);
      const fallbackTitle = item.title || item.slug;

      if (!product || !product.published || product.archived) {
        warnings.push({
          slug: item.slug,
          kind: "unavailable",
          message: unavailableMessage(fallbackTitle)
        });

        return {
          ...item,
          stock: 0
        };
      }

      const availableStock = await getAvailableStock(item.slug);
      const nextQuantity = availableStock > 0 ? Math.min(item.quantity, availableStock) : item.quantity;
      const nextItem = {
        slug: item.slug,
        title: product.title,
        priceCents: product.priceCents,
        image: product.images[0] || item.image,
        stock: availableStock,
        quantity: nextQuantity
      };

      if (product.priceCents !== item.priceCents) {
        warnings.push({
          slug: item.slug,
          kind: "price_changed",
          message: `${product.title} changed price from $${(item.priceCents / 100).toFixed(2)} to $${(
            product.priceCents / 100
          ).toFixed(2)}.`
        });
      }

      if (availableStock <= 0) {
        warnings.push({
          slug: item.slug,
          kind: "unavailable",
          message: unavailableMessage(product.title)
        });
        return {
          ...nextItem,
          quantity: item.quantity
        };
      }

      if (nextQuantity < item.quantity) {
        warnings.push({
          slug: item.slug,
          kind: "quantity_reduced",
          message: `${product.title} was reduced from ${item.quantity} to ${nextQuantity} based on live availability.`
        });
      }

      return nextItem;
    })
  );

  return Response.json({
    ok: true,
    items: refreshedItems,
    warnings
  });
}
