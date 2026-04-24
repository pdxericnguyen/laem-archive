import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { readOrder, writeOrder, type OrderShippingAddress } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

type AddressPayload = {
  orderId: string;
  address: OrderShippingAddress;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function normalizeAddress(input: Record<string, unknown>): OrderShippingAddress | null {
  const line1 = asString(input.line1);
  if (!line1) {
    return null;
  }

  return {
    name: asNullableString(input.name),
    phone: asNullableString(input.phone),
    line1,
    line2: asNullableString(input.line2),
    city: asNullableString(input.city),
    state: asNullableString(input.state),
    postalCode: asNullableString(input.postalCode),
    country: asNullableString(input.country)?.toUpperCase() || null
  };
}

async function getPayload(request: Request): Promise<AddressPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const orderId = asString(body.orderId);
    const address = normalizeAddress(body);
    return orderId && address ? { orderId, address } : null;
  }

  const formData = await request.formData();
  const orderId = asString(formData.get("orderId"));
  const address = normalizeAddress({
    name: formData.get("name"),
    phone: formData.get("phone"),
    line1: formData.get("line1"),
    line2: formData.get("line2"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country")
  });

  return orderId && address ? { orderId, address } : null;
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Order and address line 1 are required." }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (order.piiRedactedAt) {
    return NextResponse.json(
      { ok: false, error: "Customer data has been redacted for this order." },
      { status: 409 }
    );
  }
  if (order.status === "shipped" || order.status === "refunded" || order.status === "canceled") {
    return NextResponse.json(
      { ok: false, error: "Address edits are only available before terminal order states." },
      { status: 409 }
    );
  }

  const updated = {
    ...order,
    shippingAddress: payload.address
  };

  await writeOrder(updated);
  await recordAdminAuditEvent({
    action: "order_address_updated",
    entity: "order",
    entityId: order.id,
    summary: "Order shipping address updated",
    details: {
      city: payload.address.city,
      state: payload.address.state,
      country: payload.address.country
    }
  });

  return NextResponse.json({
    ok: true,
    shippingAddress: payload.address
  });
}
