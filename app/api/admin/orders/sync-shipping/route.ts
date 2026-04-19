import { NextResponse } from "next/server";
import Stripe from "stripe";

import { readOrder, type OrderShippingAddress, writeOrder } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";
import { retryStripeOperation } from "@/lib/stripe-retry";

type SyncPayload = {
  orderId: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getPayload(request: Request): Promise<SyncPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return null;
    }
    const orderId = asString(body.orderId);
    return orderId ? { orderId } : null;
  }

  const formData = await request.formData();
  const orderId = asString(formData.get("orderId"));
  return orderId ? { orderId } : null;
}

function normalizeStripeShippingAddress(
  details: Stripe.Checkout.Session.ShippingDetails | null | undefined
): OrderShippingAddress | undefined {
  const address = details?.address;
  if (!address?.line1) {
    return undefined;
  }

  return {
    name: details?.name ?? null,
    phone: details?.phone ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postalCode: address.postal_code ?? null,
    country: address.country ?? null
  };
}

function isSameShippingAddress(a: OrderShippingAddress | undefined, b: OrderShippingAddress | undefined) {
  if (!a || !b) {
    return false;
  }
  return (
    a.name === b.name &&
    a.phone === b.phone &&
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.city === b.city &&
    a.state === b.state &&
    a.postalCode === b.postalCode &&
    a.country === b.country
  );
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload?.orderId) {
    return NextResponse.json({ ok: false, error: "Missing order id." }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  if (order.channel === "terminal") {
    return NextResponse.json(
      { ok: false, error: "Terminal orders do not have Stripe Checkout shipping addresses." },
      { status: 409 }
    );
  }

  if (order.stripeObjectType === "payment_intent" || order.id.startsWith("pi_")) {
    return NextResponse.json(
      { ok: false, error: "Only Stripe Checkout orders support shipping address sync." },
      { status: 409 }
    );
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return NextResponse.json({ ok: false, error: "Missing STRIPE_SECRET_KEY." }, { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await retryStripeOperation("checkout.sessions.retrieve(admin sync shipping)", () =>
      stripe.checkout.sessions.retrieve(order.id)
    );
  } catch (error) {
    console.error("Failed to retrieve checkout session for shipping sync", {
      orderId: order.id,
      error
    });
    return NextResponse.json(
      { ok: false, error: "Unable to retrieve Stripe checkout session." },
      { status: 502 }
    );
  }

  const shippingAddress = normalizeStripeShippingAddress(session.shipping_details);
  if (!shippingAddress) {
    return NextResponse.json(
      { ok: false, error: "No shipping address found in Stripe for this session." },
      { status: 409 }
    );
  }

  if (isSameShippingAddress(order.shippingAddress, shippingAddress)) {
    return NextResponse.json({ ok: true, already: true, shippingAddress });
  }

  await writeOrder({
    ...order,
    shippingAddress
  });

  return NextResponse.json({ ok: true, shippingAddress });
}
