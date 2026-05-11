import { NextResponse } from "next/server";
import Stripe from "stripe";

import { sendPOSReceiptEmail } from "@/lib/email";
import { getProduct } from "@/lib/inventory";
import { parsePOSCartMetadata } from "@/lib/pos";
import { readOrder, writeOrder } from "@/lib/orders";
import { requirePOSOrThrow } from "@/lib/require-pos";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

type ParsedRequest = {
  paymentIntentId: string;
  email: string;
};

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320) {
    return null;
  }
  if (!email.includes("@") || !email.includes(".")) {
    return null;
  }
  return email;
}

async function parseRequest(request: Request): Promise<ParsedRequest | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const paymentIntentId =
    typeof body.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
  const email = normalizeEmail(body.email);
  if (!paymentIntentId || !email) {
    return null;
  }

  return {
    paymentIntentId,
    email
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

function isStripeInvalidRequestError(error: unknown): error is { type: string; message?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { type?: string }).type === "StripeInvalidRequestError";
}

async function resolveReceiptItems(
  order: Awaited<ReturnType<typeof readOrder>>,
  paymentIntent: Stripe.PaymentIntent
) {
  const sourceItems =
    order?.items && order.items.length > 0
      ? order.items
      : order?.slug
        ? [{ slug: order.slug, quantity: Math.max(1, order.quantity) }]
        : parsePOSCartMetadata(typeof paymentIntent.metadata?.cart === "string" ? paymentIntent.metadata.cart : null);
  if (sourceItems.length === 0) {
    return [];
  }

  const resolved = await Promise.all(
    sourceItems.map(async (item) => {
      const product = await getProduct(item.slug);
      return {
        title: product?.title || item.slug,
        quantity: Math.max(1, item.quantity)
      };
    })
  );
  return resolved;
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "terminal-send-receipt",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.ok) {
    return jsonError("Too many receipt attempts. Try again shortly.", 429, rateLimitHeaders);
  }

  try {
    await requirePOSOrThrow(request);
  } catch {
    return jsonError("Unauthorized", 401, rateLimitHeaders);
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return jsonError("Missing STRIPE_SECRET_KEY", 500, rateLimitHeaders);
  }

  const parsed = await parseRequest(request);
  if (!parsed) {
    return jsonError("Invalid payload", 400, rateLimitHeaders);
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(parsed.paymentIntentId);
  } catch (error) {
    if (isStripeInvalidRequestError(error)) {
      return jsonError("Payment intent not found", 404, rateLimitHeaders);
    }
    throw error;
  }

  if (paymentIntent.metadata?.source !== "laem_pos_terminal") {
    return jsonError("Payment intent not found", 404, rateLimitHeaders);
  }

  if (paymentIntent.status === "canceled") {
    return jsonError("Cannot send receipt for a canceled payment.", 409, rateLimitHeaders);
  }

  let orderEmailUpdated = false;
  const existingOrder = await readOrder(parsed.paymentIntentId, {
    skipPiiRetention: true
  });
  const existingOrderEmail = typeof existingOrder?.email === "string"
    ? existingOrder.email.trim().toLowerCase()
    : null;
  const alreadySet = existingOrderEmail === parsed.email;

  if (existingOrder && !existingOrder.piiRedactedAt && existingOrderEmail !== parsed.email) {
    await writeOrder({
      ...existingOrder,
      email: parsed.email
    });
    orderEmailUpdated = true;
  }
  const receiptItems = await resolveReceiptItems(existingOrder, paymentIntent);
  const amountTotal =
    existingOrder?.amount_total ??
    (typeof paymentIntent.amount_received === "number" && paymentIntent.amount_received > 0
      ? paymentIntent.amount_received
      : paymentIntent.amount);
  const currency = existingOrder?.currency ?? paymentIntent.currency ?? null;

  await sendPOSReceiptEmail({
    orderId: paymentIntent.id,
    customerEmail: parsed.email,
    amountTotal,
    currency,
    paymentLabel: "Card",
    receiptLabel: "Card Receipt",
    items: receiptItems
  });

  return NextResponse.json(
    {
      ok: true,
      paymentIntentId: paymentIntent.id,
      receiptEmail: parsed.email,
      alreadySet,
      orderEmailUpdated
    },
    {
      headers: rateLimitHeaders
    }
  );
}
