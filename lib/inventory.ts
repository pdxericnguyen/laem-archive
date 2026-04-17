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

export type CheckoutReservationStatus = "active" | "completed" | "released" | "expired";

export type CheckoutReservationRecord = {
  sessionId: string;
  items: StockRequest[];
  createdAt: number;
  expiresAt: number;
  status: CheckoutReservationStatus;
  updatedAt?: number;
};

export type MultiAtomicDecrementResult = {
  ok: boolean;
  items: Array<AtomicDecrementResult & { slug: string }>;
  reason?: "invalid_request" | "insufficient_stock";
  failedSlug?: string;
};

export type ReserveInventoryResult = {
  ok: boolean;
  expiresAt?: number;
  failedSlug?: string;
  available?: number;
  reason?: "invalid_request" | "insufficient_stock";
};

export type ReleaseInventoryReservationResult = {
  ok: boolean;
  status: "released" | "missing" | "inactive";
  reservation?: CheckoutReservationRecord | null;
};

export type ConsumeInventoryReservationResult = MultiAtomicDecrementResult & {
  source: "reservation" | "stock";
};

export type ReservationHoldSummary = {
  reservedStock: number;
  activeCheckoutCount: number;
  nextExpiresAt?: number;
  lastExpiresAt?: number;
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

export function getCheckoutReservationTtlSeconds() {
  const configured = Number(process.env.CHECKOUT_RESERVATION_TTL_SECONDS || "1800");
  if (!Number.isFinite(configured)) {
    return 1800;
  }
  return Math.max(1800, Math.min(86400, Math.floor(configured)));
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

function normalizeReservationStatus(value: unknown): CheckoutReservationStatus | null {
  return value === "active" || value === "completed" || value === "released" || value === "expired"
    ? value
    : null;
}

function buildReservationHash(
  sessionId: string,
  items: StockRequest[],
  status: CheckoutReservationStatus,
  createdAt: number,
  expiresAt: number,
  updatedAt?: number
) {
  const payload: Record<string, number | string> = {
    sessionId,
    status,
    createdAt,
    expiresAt
  };
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    payload.updatedAt = updatedAt;
  }

  for (const item of items) {
    payload[`item:${item.slug}`] = Math.max(1, Math.floor(item.quantity));
  }

  return payload;
}

export async function readInventoryReservation(sessionId: string): Promise<CheckoutReservationRecord | null> {
  const raw = await kv.hgetall<Record<string, unknown>>(key.reservation(sessionId));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const status = normalizeReservationStatus(raw.status);
  const createdAt = Math.max(0, Math.floor(parseNumberResult(raw.createdAt)));
  const expiresAt = Math.max(0, Math.floor(parseNumberResult(raw.expiresAt)));
  const updatedAtRaw = Math.max(0, Math.floor(parseNumberResult(raw.updatedAt)));
  const items = Object.entries(raw)
    .filter(([field]) => field.startsWith("item:"))
    .map(([field, value]) => {
      const slug = field.slice("item:".length).trim();
      const quantity = Math.max(1, Math.floor(parseNumberResult(value)));
      if (!slug || quantity <= 0) {
        return null;
      }
      return {
        slug,
        quantity
      };
    })
    .filter((item): item is StockRequest => Boolean(item));

  if (!status || createdAt <= 0 || expiresAt <= 0 || items.length === 0) {
    return null;
  }

  return {
    sessionId,
    items,
    createdAt,
    expiresAt,
    status,
    updatedAt: updatedAtRaw > 0 ? updatedAtRaw : undefined
  };
}

export async function getReservedStock(slug: string): Promise<number> {
  const reserved = await kv.get<number>(key.reserved(slug));
  if (typeof reserved !== "number" || !Number.isFinite(reserved)) {
    return 0;
  }
  return Math.max(0, Math.floor(reserved));
}

export async function summarizeReservationHoldsForSlugs(
  slugs: string[]
): Promise<Record<string, ReservationHoldSummary>> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  const summaries = Object.fromEntries(
    uniqueSlugs.map((slug) => [
      slug,
      {
        reservedStock: 0,
        activeCheckoutCount: 0
      }
    ])
  ) as Record<string, ReservationHoldSummary>;

  if (uniqueSlugs.length === 0) {
    return summaries;
  }

  try {
    await cleanupExpiredInventoryReservations(100);

    const trackedSlugs = new Set(uniqueSlugs);
    const now = Math.floor(Date.now() / 1000);
    let cursor: string | number = "0";

    do {
      const [nextCursor, reservationKeys] = await kv.scan(cursor, {
        match: `${key.reservation("")}*`,
        count: 100
      });
      cursor = nextCursor;

      const sessionIds = reservationKeys
        .filter(
          (reservationKey): reservationKey is string =>
            typeof reservationKey === "string" && reservationKey.startsWith(key.reservation(""))
        )
        .map((reservationKey) => reservationKey.slice(key.reservation("").length))
        .filter(Boolean);

      const reservations = await Promise.all(
        sessionIds.map(async (sessionId) => ({
          sessionId,
          reservation: await readInventoryReservation(sessionId)
        }))
      );

      for (const { sessionId, reservation } of reservations) {
        if (!reservation || reservation.status !== "active") {
          continue;
        }

        if (reservation.expiresAt <= now) {
          await releaseInventoryReservation(sessionId, "expired", now);
          continue;
        }

        for (const item of reservation.items) {
          if (trackedSlugs.has(item.slug)) {
            const summary = summaries[item.slug];
            summary.reservedStock += item.quantity;
            summary.activeCheckoutCount += 1;
            summary.nextExpiresAt = summary.nextExpiresAt
              ? Math.min(summary.nextExpiresAt, reservation.expiresAt)
              : reservation.expiresAt;
            summary.lastExpiresAt = summary.lastExpiresAt
              ? Math.max(summary.lastExpiresAt, reservation.expiresAt)
              : reservation.expiresAt;
          }
        }
      }
    } while (cursor !== "0");

    await Promise.all(uniqueSlugs.map((slug) => kv.set(key.reserved(slug), summaries[slug]?.reservedStock || 0)));
    return summaries;
  } catch (error) {
    console.error("Reserved stock reconciliation failed", {
      error,
      slugs: uniqueSlugs
    });

    const fallback = await Promise.all(
      uniqueSlugs.map(async (slug) => [
        slug,
        {
          reservedStock: await getReservedStock(slug),
          activeCheckoutCount: 0
        }
      ] as const)
    );
    return Object.fromEntries(fallback);
  }
}

export async function reconcileReservedStockForSlugs(
  slugs: string[]
): Promise<Record<string, number>> {
  const summaries = await summarizeReservationHoldsForSlugs(slugs);
  return Object.fromEntries(
    Object.entries(summaries).map(([slug, summary]) => [slug, summary.reservedStock])
  );
}

export async function getAvailableStockForSlugs(slugs: string[]): Promise<Record<string, number>> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  const rows = await Promise.all(
    uniqueSlugs.map(async (slug) => {
      const [stock, reserved] = await Promise.all([getStock(slug), getReservedStock(slug)]);
      return [slug, Math.max(0, stock - reserved)] as const;
    })
  );

  return Object.fromEntries(rows);
}

export async function getAvailableStock(slug: string): Promise<number> {
  const availabilityBySlug = await getAvailableStockForSlugs([slug]);
  return availabilityBySlug[slug] || 0;
}

export async function reserveInventoryForCheckoutSession(
  sessionId: string,
  input: StockRequest[],
  expiresAt: number
): Promise<ReserveInventoryResult> {
  const requests = normalizeRequests(input);
  if (!sessionId || requests.length === 0) {
    return { ok: false, reason: "invalid_request" };
  }

  for (const request of requests) {
    await ensureStockKey(request.slug);
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const ttlExpiry = Math.max(createdAt + 60, Math.floor(expiresAt));
  const script = `
local count = tonumber(ARGV[1]) or 0
local sessionId = ARGV[2]
local createdAt = tonumber(ARGV[3]) or 0
local expiresAt = tonumber(ARGV[4]) or 0
local reservationKey = KEYS[count * 2 + 1]
local reservationsIndexKey = KEYS[count * 2 + 2]

local existingStatus = redis.call("HGET", reservationKey, "status")
if existingStatus == "active" then
  return {1, 0, 0}
end

for i = 1, count do
  local stock = tonumber(redis.call("GET", KEYS[i]) or "0") or 0
  local reserved = tonumber(redis.call("GET", KEYS[count + i]) or "0") or 0
  local qty = tonumber(ARGV[4 + i]) or 0
  if stock < 0 then
    stock = 0
  end
  if reserved < 0 then
    reserved = 0
  end
  local available = stock - reserved
  if available < qty then
    return {0, i, available}
  end
end

for i = 1, count do
  local qty = tonumber(ARGV[4 + i]) or 0
  redis.call("INCRBY", KEYS[count + i], qty)
end

redis.call("HSET", reservationKey, "sessionId", sessionId, "status", "active", "createdAt", createdAt, "expiresAt", expiresAt)
for i = 1, count do
  local slug = ARGV[4 + count + i]
  local qty = tonumber(ARGV[4 + i]) or 0
  redis.call("HSET", reservationKey, "item:" .. slug, qty)
end
redis.call("ZADD", reservationsIndexKey, expiresAt, sessionId)
redis.call("EXPIREAT", reservationKey, expiresAt + 604800)
return {1, 0, 0}
`;

  const keys = [
    ...requests.map((request) => key.stock(request.slug)),
    ...requests.map((request) => key.reserved(request.slug)),
    key.reservation(sessionId),
    key.reservationsExpiring
  ];
  const args = [
    String(requests.length),
    sessionId,
    String(createdAt),
    String(ttlExpiry),
    ...requests.map((request) => String(request.quantity)),
    ...requests.map((request) => request.slug)
  ];

  try {
    const response = (await kv.eval(script, keys, args)) as unknown;
    if (Array.isArray(response)) {
      const ok = parseNumberResult(response[0]) === 1;
      if (ok) {
        return { ok: true, expiresAt: ttlExpiry };
      }
      const failedIndex = Math.max(1, Math.floor(parseNumberResult(response[1])));
      const failedSlug = requests[failedIndex - 1]?.slug;
      const available = Math.max(0, Math.floor(parseNumberResult(response[2])));
      return {
        ok: false,
        reason: "insufficient_stock",
        failedSlug,
        available
      };
    }
  } catch (error) {
    console.error("Inventory reservation eval failed; falling back to sequential reserve", {
      error,
      sessionId,
      requests
    });
  }

  const existing = await readInventoryReservation(sessionId);
  if (existing?.status === "active") {
    return { ok: true, expiresAt: existing.expiresAt };
  }

  for (const request of requests) {
    const available = await getAvailableStock(request.slug);
    if (available < request.quantity) {
      return {
        ok: false,
        reason: "insufficient_stock",
        failedSlug: request.slug,
        available
      };
    }
  }

  for (const request of requests) {
    await kv.incrby(key.reserved(request.slug), request.quantity);
  }
  await kv.hset(key.reservation(sessionId), buildReservationHash(sessionId, requests, "active", createdAt, ttlExpiry));
  await kv.zadd(key.reservationsExpiring, {
    score: ttlExpiry,
    member: sessionId
  });
  await kv.expireat(key.reservation(sessionId), ttlExpiry + 604800);

  return { ok: true, expiresAt: ttlExpiry };
}

export async function releaseInventoryReservation(
  sessionId: string,
  nextStatus: CheckoutReservationStatus = "released",
  updatedAt = Math.floor(Date.now() / 1000)
): Promise<ReleaseInventoryReservationResult> {
  const reservation = await readInventoryReservation(sessionId);
  if (!reservation) {
    await kv.zrem(key.reservationsExpiring, sessionId);
    return { ok: false, status: "missing", reservation: null };
  }

  if (reservation.status !== "active") {
    await kv.zrem(key.reservationsExpiring, sessionId);
    return { ok: false, status: "inactive", reservation };
  }

  const script = `
local count = tonumber(ARGV[1]) or 0
local nextStatus = ARGV[2]
local updatedAt = tonumber(ARGV[3]) or 0
local reservationKey = KEYS[1]
local reservationsIndexKey = KEYS[2]
local sessionId = ARGV[4]

local status = redis.call("HGET", reservationKey, "status")
if status ~= "active" then
  return {0}
end

for i = 1, count do
  local reservedKey = KEYS[2 + i]
  local qty = tonumber(ARGV[4 + i]) or 0
  local currentReserved = tonumber(redis.call("GET", reservedKey) or "0") or 0
  if currentReserved < 0 then
    currentReserved = 0
  end
  local nextReserved = currentReserved - qty
  if nextReserved < 0 then
    nextReserved = 0
  end
  redis.call("SET", reservedKey, nextReserved)
end

redis.call("HSET", reservationKey, "status", nextStatus, "updatedAt", updatedAt)
redis.call("ZREM", reservationsIndexKey, sessionId)
return {1}
`;

  const keys = [
    key.reservation(sessionId),
    key.reservationsExpiring,
    ...reservation.items.map((item) => key.reserved(item.slug))
  ];
  const args = [
    String(reservation.items.length),
    nextStatus,
    String(updatedAt),
    sessionId,
    ...reservation.items.map((item) => String(item.quantity))
  ];

  try {
    await kv.eval(script, keys, args);
    return { ok: true, status: "released", reservation };
  } catch (error) {
    console.error("Inventory reservation release eval failed; falling back to sequential release", {
      error,
      sessionId
    });
  }

  for (const item of reservation.items) {
    const currentReserved = await getReservedStock(item.slug);
    const nextReserved = Math.max(0, currentReserved - item.quantity);
    await kv.set(key.reserved(item.slug), nextReserved);
  }
  await kv.hset(
    key.reservation(sessionId),
    buildReservationHash(sessionId, reservation.items, nextStatus, reservation.createdAt, reservation.expiresAt, updatedAt)
  );
  await kv.zrem(key.reservationsExpiring, sessionId);
  return { ok: true, status: "released", reservation };
}

export async function cleanupExpiredInventoryReservations(limit = 25) {
  const now = Math.floor(Date.now() / 1000);
  const batchSize = Math.max(1, Math.floor(limit));
  const expiredSessionIds =
    (await kv.zrange<string[]>(
      key.reservationsExpiring,
      "-inf",
      now,
      {
        byScore: true,
        offset: 0,
        count: batchSize
      }
    )) || [];

  let released = 0;
  for (const sessionId of expiredSessionIds) {
    if (typeof sessionId !== "string" || !sessionId) {
      continue;
    }
    const result = await releaseInventoryReservation(sessionId, "expired", now);
    if (result.ok) {
      released += 1;
    }
  }

  return {
    checked: expiredSessionIds.length,
    released
  };
}

export async function consumeInventoryReservation(
  sessionId: string
): Promise<ConsumeInventoryReservationResult | null> {
  const reservation = await readInventoryReservation(sessionId);
  if (!reservation) {
    return null;
  }

  if (reservation.status !== "active") {
    return null;
  }

  for (const item of reservation.items) {
    await ensureStockKey(item.slug);
  }

  const updatedAt = Math.floor(Date.now() / 1000);
  const script = `
local count = tonumber(ARGV[1]) or 0
local updatedAt = tonumber(ARGV[2]) or 0
local sessionId = ARGV[3]
local reservationKey = KEYS[1]
local reservationsIndexKey = KEYS[2]

local status = redis.call("HGET", reservationKey, "status")
if status ~= "active" then
  return {0}
end

local out = {1}
for i = 1, count do
  local stockKey = KEYS[2 + i]
  local reservedKey = KEYS[2 + count + i]
  local qty = tonumber(ARGV[3 + i]) or 0
  local currentStock = tonumber(redis.call("GET", stockKey) or "0") or 0
  local currentReserved = tonumber(redis.call("GET", reservedKey) or "0") or 0
  if currentStock < 0 then
    currentStock = 0
  end
  if currentReserved < 0 then
    currentReserved = 0
  end

  local nextStock = currentStock - qty
  if nextStock < 0 then
    nextStock = 0
  end

  local nextReserved = currentReserved - qty
  if nextReserved < 0 then
    nextReserved = 0
  end

  redis.call("SET", stockKey, nextStock)
  redis.call("SET", reservedKey, nextReserved)
  table.insert(out, currentStock)
  table.insert(out, nextStock)
end

redis.call("HSET", reservationKey, "status", "completed", "updatedAt", updatedAt)
redis.call("ZREM", reservationsIndexKey, sessionId)
return out
`;

  const keys = [
    key.reservation(sessionId),
    key.reservationsExpiring,
    ...reservation.items.map((item) => key.stock(item.slug)),
    ...reservation.items.map((item) => key.reserved(item.slug))
  ];
  const args = [
    String(reservation.items.length),
    String(updatedAt),
    sessionId,
    ...reservation.items.map((item) => String(item.quantity))
  ];

  try {
    const response = (await kv.eval(script, keys, args)) as unknown;
    if (Array.isArray(response) && parseNumberResult(response[0]) === 1) {
      return {
        ok: true,
        source: "reservation",
        items: reservation.items.map((item, index) => {
          const current = Math.max(0, Math.floor(parseNumberResult(response[1 + index * 2])));
          const next = Math.max(0, Math.floor(parseNumberResult(response[2 + index * 2], current)));
          return {
            slug: item.slug,
            ...toResult(item.quantity, true, current, next)
          };
        })
      };
    }
  } catch (error) {
    console.error("Reservation consume eval failed; falling back to sequential consume", {
      error,
      sessionId
    });
  }

  const items = [];
  for (const item of reservation.items) {
    const currentStock = await getStock(item.slug);
    const currentReserved = await getReservedStock(item.slug);
    const nextStock = Math.max(0, currentStock - item.quantity);
    const nextReserved = Math.max(0, currentReserved - item.quantity);
    await kv.set(key.stock(item.slug), nextStock);
    await kv.set(key.reserved(item.slug), nextReserved);
    items.push({
      slug: item.slug,
      ...toResult(item.quantity, true, currentStock, nextStock)
    });
  }

  await kv.hset(
    key.reservation(sessionId),
    buildReservationHash(sessionId, reservation.items, "completed", reservation.createdAt, reservation.expiresAt, updatedAt)
  );
  await kv.zrem(key.reservationsExpiring, sessionId);

  return {
    ok: true,
    source: "reservation",
    items
  };
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
