import { key, kv } from "@/lib/kv";
import type { Product } from "@/lib/store";

export type ProductRecord = Product & {
  priceId?: string;
  updatedAt?: number;
};

export async function getProduct(slug: string): Promise<ProductRecord | null> {
  const direct = await kv.get<ProductRecord>(key.product(slug));
  if (direct) {
    return direct;
  }

  const products = await kv.get<ProductRecord[]>(key.products);
  if (!Array.isArray(products)) {
    return null;
  }

  return products.find((product) => product.slug === slug) || null;
}

export async function getStock(slug: string): Promise<number> {
  const stock = await kv.get<number>(key.stock(slug));
  if (typeof stock === "number") {
    return Math.max(0, Math.floor(stock));
  }

  const product = await getProduct(slug);
  if (!product) {
    return 0;
  }

  return Math.max(0, Math.floor(product.stock));
}

export async function setStock(slug: string, nextValue: number) {
  const stock = Math.max(0, Math.floor(nextValue));
  await kv.set(key.stock(slug), stock);
}

async function updateProductSnapshot(
  slug: string,
  updater: (product: ProductRecord) => ProductRecord
): Promise<ProductRecord | null> {
  const direct = await kv.get<ProductRecord>(key.product(slug));
  const products = await kv.get<ProductRecord[]>(key.products);
  const list = Array.isArray(products) ? products : [];
  const index = list.findIndex((product) => product.slug === slug);
  const base = direct ?? (index >= 0 ? list[index] : null);

  if (!base) {
    return null;
  }

  const nextProduct = updater(base);
  await kv.set(key.product(slug), nextProduct);
  if (index >= 0) {
    list[index] = nextProduct;
    await kv.set(key.products, list);
  }

  await kv.set(key.archived(slug), Boolean(nextProduct.archived));
  return nextProduct;
}

export async function syncProductStockAndArchiveState(slug: string, stockValue: number) {
  const stock = Math.max(0, Math.floor(stockValue));
  return updateProductSnapshot(slug, (product) => {
    const shouldAutoArchive = Boolean(product.autoArchiveOnZero) && stock <= 0;
    return {
      ...product,
      stock,
      archived: shouldAutoArchive ? true : Boolean(product.archived)
    };
  });
}

export async function isPublished(slug: string) {
  const published = await kv.get<boolean>(key.published(slug));
  if (typeof published === "boolean") {
    return published;
  }

  const product = await getProduct(slug);
  return Boolean(product?.published);
}

export async function isArchived(slug: string) {
  const archived = await kv.get<boolean>(key.archived(slug));
  if (typeof archived === "boolean") {
    return archived;
  }

  const product = await getProduct(slug);
  return Boolean(product?.archived);
}

export async function listSlugs(): Promise<string[]> {
  const indexed = await kv.lrange<string>(key.productsIndex, 0, 999);
  if (Array.isArray(indexed) && indexed.length > 0) {
    return indexed.filter((value): value is string => typeof value === "string");
  }

  const products = await kv.get<ProductRecord[]>(key.products);
  if (!Array.isArray(products)) {
    return [];
  }

  return products.map((product) => product.slug);
}

export async function decrementStock(slug: string, quantity: number) {
  const q = Math.max(1, Math.floor(quantity));
  const current = await getStock(slug);

  if (typeof kv.incrby === "function") {
    const next = await kv.incrby(key.stock(slug), -q);
    if (typeof next === "number" && next < 0) {
      await kv.set(key.stock(slug), 0);
      return { current, next: 0 };
    }
    return { current, next: typeof next === "number" ? next : Math.max(0, current - q) };
  }

  const next = Math.max(0, current - q);
  await kv.set(key.stock(slug), next);
  return { current, next };
}

export type StockTransition = "low" | "zero";

export type AtomicDecrementResult = {
  ok: boolean;
  requested: number;
  current: number;
  next: number;
  reason?: "invalid_quantity" | "insufficient_stock";
  transition: StockTransition | null;
};

export type StockRequest = {
  slug: string;
  quantity: number;
};

export type MultiAtomicDecrementResult = {
  ok: boolean;
  items: Array<AtomicDecrementResult & { slug: string }>;
  reason?: "invalid_request" | "insufficient_stock";
  failedSlug?: string;
};

function parseNumberResult(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return fallback;
}

function getLowStockThreshold() {
  const configured = Number(process.env.LOW_STOCK_THRESHOLD || "2");
  if (!Number.isFinite(configured)) {
    return 2;
  }
  return Math.max(1, Math.floor(configured));
}

function getStockTransition(previous: number, next: number): StockTransition | null {
  const threshold = getLowStockThreshold();
  const before = Math.max(0, Math.floor(previous));
  const after = Math.max(0, Math.floor(next));

  if (before > 0 && after === 0) {
    return "zero";
  }
  if (before > threshold && after > 0 && after <= threshold) {
    return "low";
  }
  return null;
}

async function ensureStockKey(slug: string) {
  const existing = await kv.get<number>(key.stock(slug));
  if (typeof existing === "number" && Number.isFinite(existing)) {
    return Math.max(0, Math.floor(existing));
  }

  const product = await getProduct(slug);
  const baseline = Math.max(0, Math.floor(product?.stock || 0));
  await kv.set(key.stock(slug), baseline);
  return baseline;
}

function toResult(
  requested: number,
  ok: boolean,
  current: number,
  next: number,
  reason?: "invalid_quantity" | "insufficient_stock"
): AtomicDecrementResult {
  return {
    ok,
    requested,
    current,
    next,
    reason,
    transition: ok ? getStockTransition(current, next) : null
  };
}

export async function decrementStockAtomic(slug: string, quantity: number): Promise<AtomicDecrementResult> {
  const requested = Math.floor(quantity);
  if (!Number.isFinite(requested) || requested <= 0) {
    const current = await getStock(slug);
    return toResult(0, false, current, current, "invalid_quantity");
  }

  await ensureStockKey(slug);
  const script = `
local key = KEYS[1]
local qty = tonumber(ARGV[1]) or 0
if qty <= 0 then
  return {0, -1, -1}
end

local current = tonumber(redis.call("GET", key) or "0") or 0
if current < 0 then
  current = 0
end

if current < qty then
  return {0, current, current}
end

local next = current - qty
if next < 0 then
  next = 0
end

redis.call("SET", key, next)
return {1, current, next}
`;

  try {
    const response = (await kv.eval(script, [key.stock(slug)], [String(requested)])) as unknown;
    if (Array.isArray(response)) {
      const ok = parseNumberResult(response[0]) === 1;
      const current = Math.max(0, Math.floor(parseNumberResult(response[1])));
      const next = Math.max(0, Math.floor(parseNumberResult(response[2], current)));
      if (!ok) {
        return toResult(requested, false, current, next, "insufficient_stock");
      }
      return toResult(requested, true, current, next);
    }
  } catch (error) {
    console.error("Atomic stock eval failed; falling back to incrby", { slug, requested, error });
  }

  if (typeof kv.incrby === "function") {
    const after = await kv.incrby(key.stock(slug), -requested);
    const rawNext = Math.floor(parseNumberResult(after));
    const next = Math.max(0, rawNext);
    const current = next + requested;

    if (rawNext < 0 || current < requested) {
      await kv.incrby(key.stock(slug), requested);
      const restored = await getStock(slug);
      return toResult(requested, false, restored, restored, "insufficient_stock");
    }

    if (next === 0) {
      await kv.set(key.stock(slug), 0);
    }
    return toResult(requested, true, current, next);
  }

  const current = await getStock(slug);
  if (current < requested) {
    return toResult(requested, false, current, current, "insufficient_stock");
  }
  const next = current - requested;
  await kv.set(key.stock(slug), next);
  return toResult(requested, true, current, next);
}

function normalizeRequests(input: StockRequest[]) {
  const grouped = new Map<string, number>();
  for (const row of input) {
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    const quantity = Math.floor(row.quantity);
    if (!slug || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    grouped.set(slug, (grouped.get(slug) || 0) + quantity);
  }
  return [...grouped.entries()].map(([slug, quantity]) => ({
    slug,
    quantity
  }));
}

export async function decrementMultipleStockAtomic(
  input: StockRequest[]
): Promise<MultiAtomicDecrementResult> {
  const requests = normalizeRequests(input);
  if (requests.length === 0) {
    return { ok: false, items: [], reason: "invalid_request" };
  }

  for (const request of requests) {
    await ensureStockKey(request.slug);
  }

  const keys = requests.map((request) => key.stock(request.slug));
  const args = requests.map((request) => String(request.quantity));
  const script = `
for i = 1, #KEYS do
  local qty = tonumber(ARGV[i]) or 0
  if qty <= 0 then
    return {0, i, -1}
  end
  local current = tonumber(redis.call("GET", KEYS[i]) or "0") or 0
  if current < 0 then
    current = 0
  end
  if current < qty then
    return {0, i, current}
  end
end

local out = {1}
for i = 1, #KEYS do
  local qty = tonumber(ARGV[i]) or 0
  local current = tonumber(redis.call("GET", KEYS[i]) or "0") or 0
  if current < 0 then
    current = 0
  end
  local next = current - qty
  if next < 0 then
    next = 0
  end
  redis.call("SET", KEYS[i], next)
  table.insert(out, current)
  table.insert(out, next)
end
return out
`;

  try {
    const response = (await kv.eval(script, keys, args)) as unknown;
    if (Array.isArray(response) && response.length > 0) {
      const ok = parseNumberResult(response[0]) === 1;
      if (!ok) {
        const failedIndex = Math.max(1, Math.floor(parseNumberResult(response[1])));
        const failedSlug = requests[failedIndex - 1]?.slug;
        const available = Math.max(0, Math.floor(parseNumberResult(response[2])));
        return {
          ok: false,
          reason: "insufficient_stock",
          failedSlug,
          items: failedSlug
            ? [
                {
                  slug: failedSlug,
                  ...toResult(requests[failedIndex - 1]?.quantity || 0, false, available, available, "insufficient_stock")
                }
              ]
            : []
        };
      }

      const items = requests.map((request, index) => {
        const current = Math.max(0, Math.floor(parseNumberResult(response[1 + index * 2])));
        const next = Math.max(0, Math.floor(parseNumberResult(response[2 + index * 2], current)));
        return {
          slug: request.slug,
          ...toResult(request.quantity, true, current, next)
        };
      });

      return { ok: true, items };
    }
  } catch (error) {
    console.error("Multi-stock atomic eval failed; falling back to sequential update", {
      error,
      requests
    });
  }

  // Fallback path when script execution is unavailable.
  const applied: Array<{ slug: string; previous: number; next: number; quantity: number }> = [];
  for (const request of requests) {
    const current = await getStock(request.slug);
    if (current < request.quantity) {
      for (const row of applied) {
        await setStock(row.slug, row.previous);
      }
      return {
        ok: false,
        reason: "insufficient_stock",
        failedSlug: request.slug,
        items: [
          {
            slug: request.slug,
            ...toResult(request.quantity, false, current, current, "insufficient_stock")
          }
        ]
      };
    }

    const next = current - request.quantity;
    await setStock(request.slug, next);
    applied.push({ slug: request.slug, previous: current, next, quantity: request.quantity });
  }

  return {
    ok: true,
    items: applied.map((row) => ({
      slug: row.slug,
      ...toResult(row.quantity, true, row.previous, row.next)
    }))
  };
}
