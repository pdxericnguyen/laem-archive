import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { sendCashReceiptEmail, sendOrderReceivedEmail, sendShippedEmail } from "@/lib/email";
import { getProduct } from "@/lib/inventory";
import { readOrder } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

type ResendEmailPayload = {
  orderId: string;
  kind: "order_received" | "shipped";
};

function normalizeKind(value: unknown): ResendEmailPayload["kind"] | null {
  if (value === "order_received" || value === "shipped") {
    return value;
  }
  return null;
}

async function getPayload(request: Request): Promise<ResendEmailPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const kind = normalizeKind(body.kind);
    return orderId && kind ? { orderId, kind } : null;
  }

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") || "").trim();
  const kind = normalizeKind(formData.get("kind"));
  return orderId && kind ? { orderId, kind } : null;
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (!order.email) {
    return NextResponse.json({ ok: false, error: "Order does not have a customer email." }, { status: 409 });
  }

  if (payload.kind === "shipped") {
    if (!order.shipping) {
      return NextResponse.json({ ok: false, error: "Order has no shipping details to resend." }, { status: 409 });
    }
    await sendShippedEmail({
      orderId: order.id,
      customerEmail: order.email,
      carrier: order.shipping.carrier,
      trackingNumber: order.shipping.trackingNumber,
      trackingUrl: order.shipping.trackingUrl
    });
  } else {
    if (order.channel === "cash") {
      await sendCashReceiptEmail({
        orderId: order.id,
        customerEmail: order.email,
        amountTotal: order.amount_total,
        currency: order.currency
      });
      await recordAdminAuditEvent({
        action: "order_email_resent",
        entity: "order",
        entityId: order.id,
        summary: "Cash receipt email resent",
        details: {
          kind: "cash_receipt",
          customerEmail: order.email
        }
      });
      return NextResponse.json({ ok: true });
    }

    const primarySlug = order.items?.[0]?.slug || order.slug;
    const firstProduct = primarySlug ? await getProduct(primarySlug) : null;
    await sendOrderReceivedEmail({
      orderId: order.id,
      customerEmail: order.email,
      productTitle: firstProduct?.title ?? null,
      quantity: order.quantity
    });
  }

  await recordAdminAuditEvent({
    action: "order_email_resent",
    entity: "order",
    entityId: order.id,
    summary: payload.kind === "shipped" ? "Shipping email resent" : "Order confirmation email resent",
    details: {
      kind: payload.kind,
      customerEmail: order.email
    }
  });

  return NextResponse.json({ ok: true });
}
