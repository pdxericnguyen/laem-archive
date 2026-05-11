import { NextResponse } from "next/server";
import Stripe from "stripe";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { getStock, setStock, syncProductStockAndArchiveState } from "@/lib/inventory";
import { recordInventoryLedgerEvent } from "@/lib/inventory-ledger";
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

async function restockOrderItems(order: OrderRecord) {
  const rows: Array<{ slug: string; quantity: number; previous: number; next: number }> = [];

  for (const item of getOrderLineItems(order)) {
    const quantity = Math.max(1, Math.floor(item.quantity || 1));
    const previous = await getStock(item.slug);
    const next = previous + quantity;
    await setStock(item.slug, next);
    await syncProductStockAndArchiveState(item.slug, next);
    await recordInventoryLedgerEvent({
      slug: item.slug,
      kind: "stock_adjusted",
      source: order.channel === "terminal" ? "terminal" : "cash",
      referenceId: order.id,
      quantity,
      stockBefore: previous,
      stockAfter: next,
      stockDelta: quantity,
      note: "Restocked after POS refund."
    });
    rows.push({
      slug: item.slug,
      quantity,
      previous,
      next
    });
  }

  return rows;
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
