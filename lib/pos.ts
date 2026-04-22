import {
  getCheckoutLimitsFromEnv,
  validateCartMetadataSize,
  validateCheckoutLimits
} from "@/lib/checkout-validation";
import { getAvailableStock, getProduct } from "@/lib/inventory";
import { getShopItems } from "@/lib/store";

export type POSProduct = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  currency: string;
  imageURL: string | null;
  stock: number;
  archived: boolean;
  published: boolean;
};

export type POSCartItem = {
  slug: string;
  quantity: number;
};

export type ResolvedPOSCartItem = POSCartItem & {
  priceCents: number;
  title: string;
};

type ResolvePOSCartResult =
  | {
      ok: true;
      items: ResolvedPOSCartItem[];
    }
  | {
      ok: false;
      error: string;
      status: number;
      failedSlug?: string;
      available?: number;
    };

const MIN_POS_UNIT_AMOUNT_CENTS = 50;
const MAX_POS_UNIT_AMOUNT_CENTS = 99_999_999;

function asPositiveInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function formatPOSLimitError(message: string) {
  return message
    .replace("unique items in checkout", "unique items in POS cart")
    .replace("total units in checkout", "total POS units")
    .replace("checkout session metadata", "POS payment metadata");
}

export function getPosCurrency() {
  const configured = String(process.env.POS_CURRENCY || "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(configured) ? configured : "usd";
}

export function normalizePOSCartItem(rawSlug: unknown, rawQuantity: unknown): POSCartItem | null {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  const quantity =
    rawQuantity === undefined || rawQuantity === null || rawQuantity === ""
      ? 1
      : asPositiveInt(rawQuantity, 0);
  if (!slug || quantity <= 0) {
    return null;
  }
  return {
    slug,
    quantity
  };
}

export function collapsePOSCartItems(items: POSCartItem[]) {
  const grouped = new Map<string, number>();
  for (const item of items) {
    grouped.set(item.slug, (grouped.get(item.slug) || 0) + item.quantity);
  }
  return [...grouped.entries()].map(([slug, quantity]) => ({
    slug,
    quantity
  }));
}

export function serializePOSCartMetadata(items: POSCartItem[]) {
  return collapsePOSCartItems(items)
    .map((item) => `${item.slug}:${item.quantity}`)
    .join(",");
}

export function validatePOSCartPayload(items: POSCartItem[]) {
  const limits = getCheckoutLimitsFromEnv();
  const limitError = validateCheckoutLimits(items, limits);
  if (limitError) {
    return {
      ok: false as const,
      error: formatPOSLimitError(limitError)
    };
  }

  const metadataResult = validateCartMetadataSize(items, limits);
  if (!metadataResult.ok) {
    return metadataResult;
  }

  return {
    ok: true as const,
    cartMetadata: metadataResult.cartMetadata
  };
}

export function parsePOSCartMetadata(value: string | null | undefined): POSCartItem[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  return collapsePOSCartItems(
    value
      .split(",")
      .map((entry) => {
        const [slugRaw, quantityRaw] = entry.split(":");
        return normalizePOSCartItem(slugRaw, quantityRaw);
      })
      .filter((row): row is POSCartItem => Boolean(row))
  );
}

export async function listPOSProducts(): Promise<POSProduct[]> {
  const products = await getShopItems();
  const currency = getPosCurrency();

  const rows = await Promise.all(
    products.map(async (product) => ({
      id: product.slug,
      slug: product.slug,
      title: product.title,
      priceCents: product.priceCents,
      currency,
      imageURL: product.images[0] || null,
      stock: await getAvailableStock(product.slug),
      archived: product.archived,
      published: product.published
    }))
  );

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function resolvePOSCartItems(input: POSCartItem[]): Promise<ResolvePOSCartResult> {
  const items = collapsePOSCartItems(input);
  if (items.length === 0) {
    return {
      ok: false,
      error: "Missing items",
      status: 400
    };
  }

  const resolved: ResolvedPOSCartItem[] = [];

  for (const requested of items) {
    const product = await getProduct(requested.slug);
    if (!product || !product.published || product.archived) {
      return {
        ok: false,
        error: `Product not found: ${requested.slug}`,
        status: 404,
        failedSlug: requested.slug
      };
    }

    const available = await getAvailableStock(requested.slug);
    if (available < requested.quantity) {
      return {
        ok: false,
        error:
          available <= 0
            ? `Out of stock: ${requested.slug}`
            : `Only ${available} left for ${requested.slug}`,
        status: 409,
        failedSlug: requested.slug,
        available
      };
    }

    const priceCents = Math.max(0, Math.floor(product.priceCents || 0));
    if (priceCents < MIN_POS_UNIT_AMOUNT_CENTS || priceCents > MAX_POS_UNIT_AMOUNT_CENTS) {
      return {
        ok: false,
        error: `Product ${requested.slug} has invalid POS price. Re-save the admin price and try again.`,
        status: 400,
        failedSlug: requested.slug
      };
    }

    resolved.push({
      slug: requested.slug,
      quantity: requested.quantity,
      priceCents,
      title: product.title
    });
  }

  return {
    ok: true,
    items: resolved
  };
}

export function getPOSTotal(items: Array<{ priceCents: number; quantity: number }>) {
  return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}
