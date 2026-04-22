import { NextResponse } from "next/server";
import Stripe from "stripe";

import { releaseInventoryReservation } from "@/lib/inventory";
import { requirePOSOrThrow } from "@/lib/require-pos";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
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

function canCancelPaymentIntent(status: Stripe.PaymentIntent.Status) {
  return (
    status === "requires_payment_method" ||
    status === "requires_confirmation" ||
    status === "requires_action" ||
    status === "requires_capture" ||
    status === "processing"
  );
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "terminal-cancel-payment-intent",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.ok) {
    return jsonError("Too many terminal cancel attempts. Try again shortly.", 429, rateLimitHeaders);
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const paymentIntentId =
    typeof body?.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";

  if (!paymentIntentId) {
    return jsonError("Missing paymentIntentId", 400, rateLimitHeaders);
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (existing.metadata?.source !== "laem_pos_terminal") {
    return jsonError("Payment intent not found", 404, rateLimitHeaders);
  }

  if (existing.status === "succeeded") {
    return jsonError("Payment already succeeded and cannot be canceled.", 409, rateLimitHeaders);
  }

  if (existing.status === "canceled") {
    const release = await releaseInventoryReservation(paymentIntentId);
    return NextResponse.json(
      {
        ok: true,
        paymentIntentId,
        status: "canceled",
        reservationReleased: release.ok
      },
      { headers: rateLimitHeaders }
    );
  }

  if (!canCancelPaymentIntent(existing.status)) {
    return jsonError(`Payment intent cannot be canceled from status ${existing.status}`, 409, rateLimitHeaders);
  }

  const canceled = await stripe.paymentIntents.cancel(paymentIntentId);
  const release = await releaseInventoryReservation(paymentIntentId);

  return NextResponse.json(
    {
      ok: true,
      paymentIntentId: canceled.id,
      status: canceled.status,
      reservationReleased: release.ok
    },
    {
      headers: rateLimitHeaders
    }
  );
}
