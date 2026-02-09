import { NextResponse } from "next/server";

import { sendShippedEmail } from "@/lib/email";
import { readOrder, writeOrder } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

type ShippingPayload = {
  orderId: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
};

async function getPayload(request: Request): Promise<ShippingPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return null;
    }
    const { orderId, carrier, trackingNumber, trackingUrl } = body as Record<string, unknown>;
    if (
      typeof orderId === "string" &&
      typeof carrier === "string" &&
      typeof trackingNumber === "string" &&
      typeof trackingUrl === "string"
    ) {
      return {
        orderId,
        carrier,
        trackingNumber,
        trackingUrl
      };
    }
    return null;
  }

  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const carrier = formData.get("carrier");
  const trackingNumber = formData.get("trackingNumber");
  const trackingUrl = formData.get("trackingUrl");
  if (
    typeof orderId === "string" &&
    typeof carrier === "string" &&
    typeof trackingNumber === "string" &&
    typeof trackingUrl === "string"
  ) {
    return {
      orderId,
      carrier,
      trackingNumber,
      trackingUrl
    };
  }
  return null;
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

  if (order.status === "stock_conflict") {
    return NextResponse.json(
      { ok: false, error: "Order has stock conflict. Resolve/refund before shipping." },
      { status: 409 }
    );
  }

  if (order.status === "conflict_resolved") {
    return NextResponse.json(
      { ok: false, error: "Order conflict already resolved. Shipping is disabled for this order." },
      { status: 409 }
    );
  }

  if (order.status === "shipped") {
    return NextResponse.json({ ok: true, already: true });
  }

  const updatedOrder = {
    ...order,
    status: "shipped" as const,
    shipping: {
      carrier: payload.carrier,
      trackingNumber: payload.trackingNumber,
      trackingUrl: payload.trackingUrl,
      shippedAt: Math.floor(Date.now() / 1000)
    }
  };

  await writeOrder(updatedOrder);

  const email = order.email;
  if (email) {
    await sendShippedEmail({
      orderId: order.id,
      customerEmail: email,
      carrier: payload.carrier,
      trackingNumber: payload.trackingNumber,
      trackingUrl: payload.trackingUrl
    });
  }

  return NextResponse.json({ ok: true });
}
