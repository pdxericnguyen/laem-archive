import { NextResponse } from "next/server";

import {
  cleanupExpiredInventoryReservations,
  consumeInventoryReservation,
  getCheckoutReservationTtlSeconds,
  reserveInventoryForCheckoutSession,
  syncProductStockAndArchiveState
} from "@/lib/inventory";
import { recordInventoryLedgerEvent } from "@/lib/inventory-ledger";
import {
  collapsePOSCartItems,
  getPosCurrency,
  getPOSTotal,
  normalizePOSCartItem,
  resolvePOSCartItems,
  validatePOSCartPayload
} from "@/lib/pos";
import {
  acquireOrderProcessingLock,
  appendOrderToIndex,
  readOrder,
  releaseOrderProcessingLock,
  writeOrder,
  type OrderRecord
} from "@/lib/orders";
import { requirePOSOrThrow } from "@/lib/require-pos";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

type ParsedRequest = {
  items: Array<{ slug: string; quantity: number }>;
  clientSaleId: string | null;
};

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeClientSaleId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return normalized || null;
}

function generateCashOrderId(clientSaleId: string | null) {
  if (clientSaleId) {
    return `cash_${clientSaleId}`;
  }
  try {
    return `cash_${crypto.randomUUID()}`;
  } catch {
    return `cash_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function parseRequest(request: Request): Promise<ParsedRequest | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const items = Array.isArray(body.items)
    ? collapsePOSCartItems(
        body.items
          .map((row) => {
            if (!row || typeof row !== "object") {
              return null;
            }
            const item = row as Record<string, unknown>;
            return normalizePOSCartItem(item.slug, item.quantity);
          })
          .filter((row): row is { slug: string; quantity: number } => Boolean(row))
      )
    : (() => {
        const single = normalizePOSCartItem(body.slug, body.quantity);
        return single ? [single] : [];
      })();

  return {
    items,
    clientSaleId: normalizeClientSaleId(body.clientSaleId)
  };
}

function jsonError(message: string, status: number, headers: HeadersInit) {
  return NextResponse.json(
    {
      ok: false,
      error: message
    },
    {
      status,
      headers
    }
  );
}

function formatReservationError(slug: string, available: number) {
  if (available <= 0) {
    return `Out of stock: ${slug}`;
  }
  return `Only ${available} left for ${slug}`;
}

function toCashSaleResponse(order: OrderRecord) {
  return {
    ok: true,
    orderId: order.id,
    amount: order.amount_total,
    currency: order.currency,
    created: order.created,
    alreadyRecorded: true
  };
}

async function recordCashStockSale(orderId: string, stockResult: NonNullable<Awaited<ReturnType<typeof consumeInventoryReservation>>>) {
  for (const item of stockResult.items) {
    await syncProductStockAndArchiveState(item.slug, item.next);
  }

  await Promise.all(
    stockResult.items.map((item) =>
      recordInventoryLedgerEvent({
        slug: item.slug,
        kind: "stock_sold",
        source: "cash",
        referenceId: orderId,
        quantity: item.requested,
        stockBefore: item.current,
        stockAfter: item.next,
        stockDelta: item.next - item.current
      })
    )
  );
}

async function finishCashSaleInventory(orderId: string) {
  const stockResult = await consumeInventoryReservation(orderId);
  if (!stockResult) {
    return { ok: true as const, alreadyFinalized: true as const };
  }
  if (!stockResult.ok) {
    const failedSlug = stockResult.failedSlug || "unknown";
    const available = stockResult.items[0]?.current || 0;
    return {
      ok: false as const,
      error: formatReservationError(failedSlug, available)
    };
  }

  await recordCashStockSale(orderId, stockResult);
  return { ok: true as const, alreadyFinalized: false as const };
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "pos-cash-sale",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.ok) {
    return jsonError("Too many cash sale attempts. Try again shortly.", 429, rateLimitHeaders);
  }

  try {
    await requirePOSOrThrow(request);
  } catch {
    return jsonError("Unauthorized", 401, rateLimitHeaders);
  }

  const parsed = await parseRequest(request);
  if (!parsed) {
    return jsonError("Invalid request payload", 400, rateLimitHeaders);
  }

  const payloadValidation = validatePOSCartPayload(parsed.items);
  if (!payloadValidation.ok) {
    return jsonError(payloadValidation.error, 400, rateLimitHeaders);
  }

  const resolved = await resolvePOSCartItems(parsed.items);
  if (resolved.ok === false) {
    return jsonError(resolved.error, resolved.status, rateLimitHeaders);
  }

  await cleanupExpiredInventoryReservations();

  const orderId = generateCashOrderId(parsed.clientSaleId);
  const lock = await acquireOrderProcessingLock(orderId);
  if (!lock.ok) {
    if (lock.reason === "already_processed") {
      const existingOrder = await readOrder(orderId, { skipPiiRetention: true });
      if (existingOrder) {
        await appendOrderToIndex(orderId);
        const finalize = await finishCashSaleInventory(orderId);
        if (!finalize.ok) {
          return jsonError(finalize.error, 409, rateLimitHeaders);
        }
        return NextResponse.json(toCashSaleResponse(existingOrder), { headers: rateLimitHeaders });
      }
    }
    return jsonError("Cash sale is already being recorded.", 409, rateLimitHeaders);
  }

  try {
    const expiresAt = Math.floor(Date.now() / 1000) + getCheckoutReservationTtlSeconds();
    const reservation = await reserveInventoryForCheckoutSession(orderId, resolved.items, expiresAt);
    if (!reservation.ok) {
      const errorMessage =
        reservation.reason === "insufficient_stock" && reservation.failedSlug
          ? formatReservationError(reservation.failedSlug, Math.max(0, reservation.available || 0))
          : "Unable to reserve inventory";
      const status = reservation.reason === "insufficient_stock" ? 409 : 500;
      return jsonError(errorMessage, status, rateLimitHeaders);
    }

    const totalQuantity = resolved.items.reduce((sum, item) => sum + item.quantity, 0);
    const primarySlug = resolved.items[0]?.slug || null;
    const created = Math.floor(Date.now() / 1000);
    const order: OrderRecord = {
      id: orderId,
      slug: primarySlug,
      email: null,
      created,
      quantity: totalQuantity,
      items: resolved.items.map((item) => ({
        slug: item.slug,
        quantity: item.quantity
      })),
      status: "paid",
      amount_total: getPOSTotal(resolved.items),
      currency: getPosCurrency(),
      channel: "cash"
    };

    await writeOrder(order);
    await appendOrderToIndex(orderId);

    const finalize = await finishCashSaleInventory(orderId);
    if (!finalize.ok) {
      return jsonError(finalize.error, 409, rateLimitHeaders);
    }

    return NextResponse.json(
      {
        ok: true,
        orderId,
        amount: order.amount_total,
        currency: order.currency,
        created,
        alreadyRecorded: false
      },
      {
        headers: rateLimitHeaders
      }
    );
  } finally {
    await releaseOrderProcessingLock(orderId, lock.token).catch((error) => {
      console.error("Failed to release cash sale lock", {
        orderId,
        error
      });
    });
  }
}
