import { NextResponse } from "next/server";
import Stripe from "stripe";

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

function getStripeInvalidRequestMessage(error: unknown, fallback: string) {
  if (!isStripeInvalidRequestError(error)) {
    return fallback;
  }
  const message = error.message?.trim();
  return message || fallback;
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

  const existingEmail = typeof paymentIntent.receipt_email === "string"
    ? paymentIntent.receipt_email.trim().toLowerCase()
    : null;
  const alreadySet = existingEmail === parsed.email;

  let updatedPaymentIntent = paymentIntent;
  if (!alreadySet) {
    try {
      updatedPaymentIntent = await stripe.paymentIntents.update(parsed.paymentIntentId, {
        receipt_email: parsed.email
      });
    } catch (error) {
      if (isStripeInvalidRequestError(error)) {
        return jsonError(
          getStripeInvalidRequestMessage(error, "Unable to update receipt email."),
          409,
          rateLimitHeaders
        );
      }
      throw error;
    }
  }

  let orderEmailUpdated = false;
  const existingOrder = await readOrder(parsed.paymentIntentId, {
    skipPiiRetention: true
  });
  if (existingOrder && !existingOrder.piiRedactedAt && existingOrder.email !== parsed.email) {
    await writeOrder({
      ...existingOrder,
      email: parsed.email
    });
    orderEmailUpdated = true;
  }

  return NextResponse.json(
    {
      ok: true,
      paymentIntentId: updatedPaymentIntent.id,
      receiptEmail: updatedPaymentIntent.receipt_email ?? parsed.email,
      alreadySet,
      orderEmailUpdated
    },
    {
      headers: rateLimitHeaders
    }
  );
}
