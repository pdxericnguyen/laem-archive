import { recordInventoryLedgerEvent } from "@/lib/inventory-ledger";
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

function normalizeStockValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeInventoryItemId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getProductInventoryItemId(
  product: Pick<ProductRecord, "inventoryItemId"> | null | undefined
) {
  return normalizeInventoryItemId(product?.inventoryItemId) || null;
}

export async function getInventoryItemIdForSlug(slug: string) {
  const product = await getProduct(slug);
  return getProductInventoryItemId(product);
}

async function getStockKeyForSlug(slug: string, product?: ProductRecord | null) {
  const resolvedProduct = product === undefined ? await getProduct(slug) : product;
  const inventoryItemId = getProductInventoryItemId(resolvedProduct);
  return inventoryItemId ? key.stock(inventoryItemId) : null;
}

async function getRequiredStockKeyForSlug(slug: string, product?: ProductRecord | null) {
  const stockKey = await getStockKeyForSlug(slug, product);
  if (!stockKey) {
    throw new Error(`Product ${slug} is missing inventoryItemId.`);
  }
  return stockKey;
}

export async function getInventoryStockKeyForSlug(slug: string) {
  return getStockKeyForSlug(slug);
}

export async function deleteStockForSlug(slug: string) {
  const product = await getProduct(slug);
  const stockKey = await getStockKeyForSlug(slug, product);
  if (stockKey) {
    await kv.del(stockKey);
  }
}

export async function getStock(slug: string): Promise<number> {
  const product = await getProduct(slug);
  const stockKey = await getStockKeyForSlug(slug, product);
  if (!stockKey) {
    return 0;
  }

  const stock = normalizeStockValue(await kv.get<number>(stockKey));
  if (stock !== null) {
    return stock;
  }

  return 0;
}

export async function setStock(slug: string, nextValue: number) {
  const stock = Math.max(0, Math.floor(nextValue));
  const stockKey = await getRequiredStockKeyForSlug(slug);
  await kv.set(stockKey, stock);
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
    const wasAutoArchived = typeof product.autoArchivedAt === "number" && product.autoArchivedAt > 0;
    const shouldAutoArchive =
      Boolean(product.autoArchiveOnZero) &&
      Boolean(product.published) &&
      stock <= 0 &&
      (!product.archived || wasAutoArchived);
    const shouldRestoreFromAutoArchive =
      Boolean(product.autoArchiveOnZero) && wasAutoArchived && Boolean(product.archived) && stock > 0;
    const nextAutoArchivedAt = shouldAutoArchive
      ? product.autoArchivedAt || Date.now()
      : undefined;

    return {
      ...product,
      archived: shouldAutoArchive ? true : shouldRestoreFromAutoArchive ? false : Boolean(product.archived),
      autoArchivedAt: nextAutoArchivedAt
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
  const stockKey = await getInventoryStockKeyForSlug(slug);
  if (!stockKey) {
    return { current, next: current };
  }

  if (typeof kv.incrby === "function") {
    const next = await kv.incrby(stockKey, -q);
    if (typeof next === "number" && next < 0) {
      await kv.set(stockKey, 0);
      return { current, next: 0 };
    }
    return { current, next: typeof next === "number" ? next : Math.max(0, current - q) };
  }

  const next = Math.max(0, current - q);
  await kv.set(stockKey, next);
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

const STOREFRONT_RESERVATION_CLEANUP_INTERVAL_MS = 15000;
let lastStorefrontReservationCleanupAt = 0;
let storefrontReservationCleanupPromise: Promise<void> | null = null;

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

export function getInventoryScriptStatus(response: unknown): "success" | "inactive" | "unknown" {
  if (!Array.isArray(response) || response.length === 0) {
    return "unknown";
  }
  return parseNumberResult(response[0]) === 1 ? "success" : "inactive";
}

export function getLowStockThreshold() {
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

async function maybeCleanupExpiredReservationsForStorefront() {
  const now = Date.now();
  if (now - lastStorefrontReservationCleanupAt < STOREFRONT_RESERVATION_CLEANUP_INTERVAL_MS) {
    return;
  }

  if (storefrontReservationCleanupPromise) {
    await storefrontReservationCleanupPromise;
    return;
  }

  storefrontReservationCleanupPromise = (async () => {
    try {
      await cleanupExpiredInventoryReservations(25);
      lastStorefrontReservationCleanupAt = Date.now();
    } catch (error) {
      console.error("Storefront reservation cleanup failed", { error });
    } finally {
      storefrontReservationCleanupPromise = null;
    }
  })();

  await storefrontReservationCleanupPromise;
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

async function recordReservationCreatedEvents(
  sessionId: string,
  requests: StockRequest[],
  expiresAt: number
) {
  await Promise.all(
    requests.map(async (request) => {
      const reservedAfter = await getReservedStock(request.slug);
      return recordInventoryLedgerEvent({
        slug: request.slug,
        kind: "reservation_created",
        source: sessionId.startsWith("cash_") ? "cash" : sessionId.startsWith("pi_") ? "terminal" : "checkout",
        referenceId: sessionId,
        quantity: request.quantity,
        reservedBefore: Math.max(0, reservedAfter - request.quantity),
        reservedAfter,
        reservedDelta: request.quantity,
        note: `Hold expires at ${expiresAt}.`
      });
    })
  );
}

async function recordReservationReleasedEvents(
  sessionId: string,
  reservation: CheckoutReservationRecord,
  nextStatus: CheckoutReservationStatus
) {
  await Promise.all(
    reservation.items.map(async (item) => {
      const reservedAfter = await getReservedStock(item.slug);
      return recordInventoryLedgerEvent({
        slug: item.slug,
        kind: nextStatus === "expired" ? "reservation_expired" : "reservation_released",
        source: sessionId.startsWith("cash_") ? "cash" : sessionId.startsWith("pi_") ? "terminal" : "checkout",
        referenceId: sessionId,
        quantity: item.quantity,
        reservedBefore: reservedAfter + item.quantity,
        reservedAfter,
        reservedDelta: -item.quantity
      });
    })
  );
}

async function recordReservationCompletedEvents(
  sessionId: string,
  reservation: CheckoutReservationRecord
) {
  await Promise.all(
    reservation.items.map(async (item) => {
      const reservedAfter = await getReservedStock(item.slug);
      return recordInventoryLedgerEvent({
        slug: item.slug,
        kind: "reservation_completed",
        source: sessionId.startsWith("cash_") ? "cash" : sessionId.startsWith("pi_") ? "terminal" : "checkout",
        referenceId: sessionId,
        quantity: item.quantity,
        reservedBefore: reservedAfter + item.quantity,
        reservedAfter,
        reservedDelta: -item.quantity
      });
    })
  );
}

async function ensureStockKey(slug: string) {
  const product = await getProduct(slug);
  const stockKey = await getStockKeyForSlug(slug, product);
  if (!stockKey) {
    return 0;
  }

  const existing = normalizeStockValue(await kv.get<number>(stockKey));
  if (existing !== null) {
    return existing;
  }

  await kv.set(stockKey, 0);
  return 0;
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
  const reserved = normalizeStockValue(await kv.get<number>(key.reserved(slug)));
  if (reserved === null) {
    return 0;
  }
  return reserved;
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
      const [nextCursor, reservationKeys]: [string | number, unknown[]] = await kv.scan(cursor, {
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
    console.error("Reserved stock hold refresh failed", {
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

export async function refreshReservedStockForSlugs(
  slugs: string[]
): Promise<Record<string, number>> {
  const summaries = await summarizeReservationHoldsForSlugs(slugs);
  return Object.fromEntries(
    Object.entries(summaries).map(([slug, summary]) => [slug, summary.reservedStock])
  );
}

export async function getAvailableStockForSlugs(slugs: string[]): Promise<Record<string, number>> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  if (uniqueSlugs.length === 0) {
    return {};
  }

  await maybeCleanupExpiredReservationsForStorefront();

  const stockKeyRows = await Promise.all(
    uniqueSlugs.map(async (slug) => ({
      slug,
      stockKey: await getInventoryStockKeyForSlug(slug)
    }))
  );
  const validStockKeyRows = stockKeyRows.filter(
    (row): row is { slug: string; stockKey: string } => Boolean(row.stockKey)
  );
  const reservedKeys = uniqueSlugs.map((slug) => key.reserved(slug));

  // Batch KV lookups to reduce storefront latency on larger catalogs.
  const batchedStockValues =
    validStockKeyRows.length > 0
      ? await kv.mget<unknown[]>(...validStockKeyRows.map((row) => row.stockKey))
      : [];
  const batchedReservedValues = await kv.mget<unknown[]>(...reservedKeys);

  const stockBySlug = Object.fromEntries(
    validStockKeyRows.map((row, index) => [
      row.slug,
      normalizeStockValue(batchedStockValues[index]) ?? 0
    ])
  );
  const stockRows = uniqueSlugs.map((slug) => [slug, stockBySlug[slug] || 0] as const);

  const reservedRows = await Promise.all(
    uniqueSlugs.map(async (slug, index) => {
      const reserved = normalizeStockValue(batchedReservedValues[index]);
      if (reserved !== null) {
        return [slug, reserved] as const;
      }
      return [slug, await getReservedStock(slug)] as const;
    })
  );

  const reservedBySlug = Object.fromEntries(reservedRows) as Record<string, number>;

  return Object.fromEntries(
    stockRows.map(([slug, stock]) => {
      const reserved = reservedBySlug[slug] || 0;
      return [slug, Math.max(0, stock - reserved)] as const;
    })
  );
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

  const existingReservation = await readInventoryReservation(sessionId);
  if (existingReservation?.status === "active") {
    return { ok: true, expiresAt: existingReservation.expiresAt };
  }

  for (const request of requests) {
    await ensureStockKey(request.slug);
  }
  const stockKeys = await Promise.all(requests.map((request) => getInventoryStockKeyForSlug(request.slug)));
  const missingStockKeyIndex = stockKeys.findIndex((stockKey) => !stockKey);
  if (missingStockKeyIndex >= 0) {
    return {
      ok: false,
      reason: "insufficient_stock",
      failedSlug: requests[missingStockKeyIndex]?.slug,
      available: 0
    };
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
    ...(stockKeys as string[]),
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
        await recordReservationCreatedEvents(sessionId, requests, ttlExpiry);
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
  await recordReservationCreatedEvents(sessionId, requests, ttlExpiry);

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
    const response = await kv.eval(script, keys, args);
    const scriptStatus = getInventoryScriptStatus(response);
    if (scriptStatus === "success") {
      await recordReservationReleasedEvents(sessionId, reservation, nextStatus);
      return { ok: true, status: "released", reservation };
    }

    if (scriptStatus === "inactive") {
      return { ok: false, status: "inactive", reservation };
    }

    console.error("Inventory reservation release eval returned an unexpected response", {
      sessionId,
      response
    });
    return { ok: false, status: "inactive", reservation };
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
  await recordReservationReleasedEvents(sessionId, reservation, nextStatus);
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
  const stockKeys = await Promise.all(
    reservation.items.map((item) => getInventoryStockKeyForSlug(item.slug))
  );
  const missingStockKeyIndex = stockKeys.findIndex((stockKey) => !stockKey);
  if (missingStockKeyIndex >= 0) {
    const item = reservation.items[missingStockKeyIndex];
    return {
      ok: false,
      source: "reservation",
      reason: "insufficient_stock",
      failedSlug: item?.slug,
      items: item
        ? [
            {
              slug: item.slug,
              ...toResult(item.quantity, false, 0, 0, "insufficient_stock")
            }
          ]
        : []
    };
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
    ...(stockKeys as string[]),
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
    const scriptStatus = getInventoryScriptStatus(response);
    if (scriptStatus === "success" && Array.isArray(response)) {
      const result: ConsumeInventoryReservationResult = {
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
      await recordReservationCompletedEvents(sessionId, reservation);
      return result;
    }

    if (scriptStatus === "inactive") {
      return null;
    }

    console.error("Reservation consume eval returned an unexpected response", {
      sessionId,
      response
    });
    return null;
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
    await setStock(item.slug, nextStock);
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
  await recordReservationCompletedEvents(sessionId, reservation);

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
  const stockKey = await getInventoryStockKeyForSlug(slug);
  if (!stockKey) {
    return toResult(requested, false, 0, 0, "insufficient_stock");
  }
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
    const response = (await kv.eval(script, [stockKey], [String(requested)])) as unknown;
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
    const after = await kv.incrby(stockKey, -requested);
    const rawNext = Math.floor(parseNumberResult(after));
    const next = Math.max(0, rawNext);
    const current = next + requested;

    if (rawNext < 0 || current < requested) {
      await kv.incrby(stockKey, requested);
      const restored = await getStock(slug);
      return toResult(requested, false, restored, restored, "insufficient_stock");
    }

    if (next === 0) {
      await kv.set(stockKey, 0);
    }
    return toResult(requested, true, current, next);
  }

  const current = await getStock(slug);
  if (current < requested) {
    return toResult(requested, false, current, current, "insufficient_stock");
  }
  const next = current - requested;
  await kv.set(stockKey, next);
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

  const keys = await Promise.all(requests.map((request) => getInventoryStockKeyForSlug(request.slug)));
  const missingStockKeyIndex = keys.findIndex((stockKey) => !stockKey);
  if (missingStockKeyIndex >= 0) {
    const request = requests[missingStockKeyIndex];
    return {
      ok: false,
      reason: "insufficient_stock",
      failedSlug: request?.slug,
      items: request
        ? [
            {
              slug: request.slug,
              ...toResult(request.quantity, false, 0, 0, "insufficient_stock")
            }
          ]
        : []
    };
  }
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
    const response = (await kv.eval(script, keys as string[], args)) as unknown;
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
