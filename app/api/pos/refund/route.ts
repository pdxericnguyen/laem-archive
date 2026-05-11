import { NextResponse } from "next/server";
import Stripe from "stripe";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { syncProductStockAndArchiveState } from "@/lib/inventory";
import { recordInventoryLedgerEvent } from "@/lib/inventory-ledger";
import { key, kv } from "@/lib/kv";
import {
  acquireOrderFulfillmentLock,
  readOrder,
  releaseOrderFulfillmentLock,
  writeOrder,
  type OrderLineItem,
  type OrderRecord
} from "@/lib/orders";
import { requirePOSOrThrow } from "@/lib/require-pos";

export const runtime = "nodejs";

const REFUND_CONFIRMATION_TEXT = "refund";

type RestockRow = {
  slug: string;
  quantity: number;
  previous: number;
  next: number;
  alreadyRestocked: boolean;
};

type RefundPayload = {
  orderId: string;
  restock: boolean;
  reason: "duplicate" | "fraudulent" | "requested_by_customer";
  note: string;
  confirmAction: string;
};

function normalizeReason(value: unknown): RefundPayload["reason"] {
  if (value === "duplicate" || value === "fraudulent" || value === "requested_by_customer") {
    return value;
  }
  return "requested_by_customer";
}

async function getPayload(request: Request): Promise<RefundPayload | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
    return null;
  }

  return {
    orderId,
    restock: Boolean(body.restock),
    reason: normalizeReason(body.reason),
    note: typeof body.note === "string" ? body.note.trim().slice(0, 1200) : "",
    confirmAction: typeof body.confirmAction === "string" ? body.confirmAction.trim().toLowerCase() : ""
  };
}

function getOrderLineItems(order: OrderRecord): OrderLineItem[] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items;
  }
  if (order.slug) {
    return [
      {
        slug: order.slug,
        quantity: Math.max(1, Math.floor(order.quantity || 1))
      }
    ];
  }
  return [];
}

function getRestockLineItems(order: OrderRecord): OrderLineItem[] {
  const bySlug = new Map<string, number>();
  for (const item of getOrderLineItems(order)) {
    const slug = item.slug.trim();
    if (!slug) {
      continue;
    }
    const quantity = Math.max(1, Math.floor(item.quantity || 1));
    bySlug.set(slug, (bySlug.get(slug) || 0) + quantity);
  }
  return Array.from(bySlug.entries()).map(([slug, quantity]) => ({ slug, quantity }));
}

function getRefundRestockMarkerKey(orderId: string, slug: string) {
  return `order:refund-restock:${orderId}:${slug}`;
}

function parseRestockScriptResponse(response: unknown) {
  if (!Array.isArray(response) || response.length < 3) {
    throw new Error("Unable to verify refund restock.");
  }
  const applied = Number(response[0]) === 1;
  const previous = Number(response[1]);
  const next = Number(response[2]);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    throw new Error("Unable to verify refund restock.");
  }
  return {
    applied,
    previous: Math.floor(previous),
    next: Math.floor(next)
  };
}

async function restockOrderItems(order: OrderRecord): Promise<RestockRow[]> {
  const rows: RestockRow[] = [];
  const script = `
local markerExists = redis.call("EXISTS", KEYS[2])
if markerExists == 1 then
  local current = tonumber(redis.call("GET", KEYS[1]) or "0")
  return {0, current, current}
end
local quantity = tonumber(ARGV[1])
local nextStock = tonumber(redis.call("INCRBY", KEYS[1], quantity))
local previousStock = nextStock - quantity
redis.call("SET", KEYS[2], ARGV[2])
return {1, previousStock, nextStock}
`;

  for (const item of getRestockLineItems(order)) {
    const markerKey = getRefundRestockMarkerKey(order.id, item.slug);
    const response = await kv.eval(
      script,
      [key.stock(item.slug), markerKey],
      [String(item.quantity), "1"]
    );
    const result = parseRestockScriptResponse(response);
    await syncProductStockAndArchiveState(item.slug, result.next);
    if (result.applied) {
      await recordInventoryLedgerEvent({
        slug: item.slug,
        kind: "stock_adjusted",
        source: order.channel === "terminal" ? "terminal" : "cash",
        referenceId: order.id,
        quantity: item.quantity,
        stockBefore: result.previous,
        stockAfter: result.next,
        stockDelta: item.quantity,
        note: "Restocked after POS refund."
      });
    }
    rows.push({
      slug: item.slug,
      quantity: item.quantity,
      previous: result.previous,
      next: result.next,
      alreadyRestocked: !result.applied
    });
  }

  return rows;
}

async function repairRefundRestock(order: OrderRecord) {
  const restockLineItems = getRestockLineItems(order);
  if (restockLineItems.length === 0) {
    return {
      order,
      restockedRows: [] as RestockRow[]
    };
  }

  const restockedRows = await restockOrderItems(order);
  const repairedOrder: OrderRecord = {
    ...order,
    refund: order.refund
      ? {
          ...order.refund,
          restocked: true
        }
      : {
          refundId: null,
          amount: order.amount_total,
          currency: order.currency,
          reason: null,
          restocked: true,
          refundedAt: Math.floor(Date.now() / 1000)
        }
  };
  await writeOrder(repairedOrder);

  await recordAdminAuditEvent({
    action: "order_refunded",
    entity: "order",
    entityId: order.id,
    summary: "POS refund restock repaired",
    details: {
      refundId: repairedOrder.refund?.refundId || null,
      channel: order.channel,
      restocked: restockedRows
    }
  });

  return {
    order: repairedOrder,
    restockedRows
  };
}

async function createStripeRefund(order: OrderRecord, reason: RefundPayload["reason"]) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });
  const refund = await stripe.refunds.create(
    {
      payment_intent: order.id,
      reason
    },
    {
      idempotencyKey: `laem-refund:${order.id}`
    }
  );

  return {
    refundId: refund.id,
    amount: typeof refund.amount === "number" ? refund.amount : order.amount_total,
    currency: refund.currency || order.currency
  };
}

function createCashRefund(order: OrderRecord) {
  return {
    refundId: `cash_refund_${order.id}`,
    amount: order.amount_total,
    currency: order.currency
  };
}

export async function POST(request: Request) {
  try {
    await requirePOSOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }
  if (payload.confirmAction !== REFUND_CONFIRMATION_TEXT) {
    return NextResponse.json(
      { ok: false, error: `Type "${REFUND_CONFIRMATION_TEXT}" to confirm refund.` },
      { status: 400 }
    );
  }

  const lock = await acquireOrderFulfillmentLock(payload.orderId);
  if (!lock.ok) {
    return NextResponse.json({ ok: false, error: "Order is already being updated." }, { status: 409 });
  }

  try {
    const order = await readOrder(payload.orderId, { skipPiiRetention: true });
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (order.channel !== "terminal" && order.channel !== "cash") {
      return NextResponse.json({ ok: false, error: "Only POS transactions can be refunded here." }, { status: 409 });
    }
    if (order.status === "refunded" || order.status === "canceled") {
      if (order.status === "refunded" && payload.restock && order.refund?.restocked !== true) {
        const repair = await repairRefundRestock(order);
        return NextResponse.json({
          ok: true,
          already: true,
          refund: repair.order.refund || null,
          restocked: repair.restockedRows
        });
      }
      return NextResponse.json({ ok: true, already: true, refund: order.refund || null, restocked: [] });
    }

    const externalRefund =
      order.channel === "cash" ? createCashRefund(order) : await createStripeRefund(order, payload.reason);
    const refundedAt = Math.floor(Date.now() / 1000);
    const refundRecord = {
      refundId: externalRefund.refundId,
      amount: externalRefund.amount,
      currency: externalRefund.currency,
      reason: payload.reason,
      restocked: false,
      refundedAt,
      note: payload.note || null
    };
    let updatedOrder: OrderRecord = {
      ...order,
      status: "refunded",
      refund: refundRecord,
      notes: payload.note
        ? [
            {
              id: externalRefund.refundId,
              note: payload.note,
              kind: "follow_up" as const,
              createdAt: refundedAt
            },
            ...(order.notes || [])
          ].slice(0, 50)
        : order.notes
    };

    await writeOrder(updatedOrder);
    const restockedRows = payload.restock ? await restockOrderItems(order) : [];
    if (restockedRows.length > 0) {
      updatedOrder = {
        ...updatedOrder,
        refund: {
          ...refundRecord,
          restocked: true
        }
      };
      await writeOrder(updatedOrder);
    }

    await recordAdminAuditEvent({
      action: "order_refunded",
      entity: "order",
      entityId: order.id,
      summary: restockedRows.length > 0 ? "POS order refunded and restocked" : "POS order refunded",
      details: {
        refundId: externalRefund.refundId,
        channel: order.channel,
        amount: refundRecord.amount,
        currency: refundRecord.currency,
        restocked: restockedRows
      }
    });

    return NextResponse.json({
      ok: true,
      refund: updatedOrder.refund,
      restocked: restockedRows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refund transaction.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await releaseOrderFulfillmentLock(payload.orderId, lock.token).catch((error) => {
      console.error("Failed to release POS refund lock", {
        orderId: payload.orderId,
        error
      });
    });
  }
}
