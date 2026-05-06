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
import { requireAdminOrThrow } from "@/lib/require-admin";

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
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
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

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") || "").trim();
  if (!orderId) {
    return null;
  }
  return {
    orderId,
    restock: formData.get("restock") === "on",
    reason: normalizeReason(formData.get("reason")),
    note: String(formData.get("note") || "").trim().slice(0, 1200),
    confirmAction: String(formData.get("confirmAction") || "").trim().toLowerCase()
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

async function getPaymentIntentId(stripe: Stripe, order: OrderRecord) {
  if (order.stripeObjectType === "payment_intent" || order.id.startsWith("pi_")) {
    return order.id;
  }

  const session = await stripe.checkout.sessions.retrieve(order.id, {
    expand: ["payment_intent"]
  });
  const paymentIntent = session.payment_intent;
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }
  if (paymentIntent && typeof paymentIntent === "object" && "id" in paymentIntent) {
    return paymentIntent.id;
  }
  return null;
}

async function restockOrderItems(order: OrderRecord) {
  const items = getOrderLineItems(order);
  const rows: Array<{ slug: string; quantity: number; previous: number; next: number }> = [];

  for (const item of items) {
    const quantity = Math.max(1, Math.floor(item.quantity || 1));
    const previous = await getStock(item.slug);
    const next = previous + quantity;
    await setStock(item.slug, next);
    await syncProductStockAndArchiveState(item.slug, next);
    await recordInventoryLedgerEvent({
      slug: item.slug,
      kind: "stock_adjusted",
      source: "admin",
      referenceId: order.id,
      quantity,
      stockBefore: previous,
      stockAfter: next,
      stockDelta: quantity,
      note: "Restocked after admin refund."
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

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return NextResponse.json({ ok: false, error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
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

    if (order.status === "refunded" || order.status === "canceled") {
      return NextResponse.json({ ok: true, already: true, refund: order.refund || null });
    }

    if (order.channel === "cash") {
      return NextResponse.json(
        { ok: false, error: "Cash POS orders do not have a Stripe charge to refund." },
        { status: 409 }
      );
    }

    if (payload.restock && order.status === "shipped") {
      return NextResponse.json(
        { ok: false, error: "Shipped orders can be refunded here, but restocking must be handled manually." },
        { status: 409 }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16"
    });
    const paymentIntentId = await getPaymentIntentId(stripe, order);
    if (!paymentIntentId) {
      return NextResponse.json({ ok: false, error: "Unable to find payment intent for this order." }, { status: 409 });
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: payload.reason
      },
      {
        idempotencyKey: `laem-refund:${order.id}`
      }
    );
    const refundedAt = Math.floor(Date.now() / 1000);
    const shouldRestock = payload.restock && order.status !== "stock_conflict";
    const refundRecord = {
      refundId: refund.id,
      amount: typeof refund.amount === "number" ? refund.amount : order.amount_total,
      currency: refund.currency || order.currency,
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
              id: refund.id,
              note: payload.note,
              kind: "follow_up" as const,
              createdAt: refundedAt
            },
            ...(order.notes || [])
          ].slice(0, 50)
        : order.notes
    };

    await writeOrder(updatedOrder);

    const restockedRows = shouldRestock ? await restockOrderItems(order) : [];
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
      summary: restockedRows.length > 0 ? "Order refunded and restocked" : "Order refunded",
      details: {
        refundId: refund.id,
        paymentIntentId,
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
  } finally {
    await releaseOrderFulfillmentLock(payload.orderId, lock.token).catch((error) => {
      console.error("Failed to release order refund lock", {
        orderId: payload.orderId,
        error
      });
    });
  }
}
