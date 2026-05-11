import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  cleanupExpiredInventoryReservations,
  getCheckoutReservationTtlSeconds,
  reserveInventoryForCheckoutSession
} from "@/lib/inventory";
import {
  collapsePOSCartItems,
  getPosCurrency,
  getPOSTotal,
  normalizePOSCartItem,
  resolvePOSCartItems,
  validatePOSCartPayload
} from "@/lib/pos";
import { requirePOSOrThrow } from "@/lib/require-pos";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

type ParsedRequest = {
  items: Array<{ slug: string; quantity: number }>;
  captureMethod: "automatic";
};

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function parseCaptureMethod(value: unknown): "automatic" | null {
  if (value === undefined || value === null || value === "" || value === "automatic") {
    return "automatic";
  }
  return null;
}

async function parseRequest(request: Request): Promise<ParsedRequest | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const items = Array.isArray(body.items)
    ? collapsePOSCartItems(
        body.items
          .map((row) => {
            if (!row || typeof row !== "object") {
              return null;
            }
            const item = row as Record<string, unknown>;
            return normalizePOSCartItem(item.slug, item.quantity);
          })
          .filter((row): row is { slug: string; quantity: number } => Boolean(row))
      )
    : (() => {
        const single = normalizePOSCartItem(body.slug, body.quantity);
        return single ? [single] : [];
      })();

  const captureMethod = parseCaptureMethod(body.captureMethod);
  if (!captureMethod) {
    return null;
  }

  return {
    items,
    captureMethod
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

function formatReservationError(slug: string, available: number) {
  if (available <= 0) {
    return `Out of stock: ${slug}`;
  }
  return `Only ${available} left for ${slug}`;
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "terminal-create-payment-intent",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.ok) {
    return jsonError("Too many terminal payment attempts. Try again shortly.", 429, rateLimitHeaders);
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
    return jsonError("Invalid request payload", 400, rateLimitHeaders);
  }

  const payloadValidation = validatePOSCartPayload(parsed.items);
  if (!payloadValidation.ok) {
    return jsonError(payloadValidation.error, 400, rateLimitHeaders);
  }

  const resolved = await resolvePOSCartItems(parsed.items);
  if (resolved.ok === false) {
    return jsonError(resolved.error, resolved.status, rateLimitHeaders);
  }

  await cleanupExpiredInventoryReservations();

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  const singleSlug = resolved.items.length === 1 ? resolved.items[0].slug : null;
  const totalQuantity = resolved.items.reduce((sum, item) => sum + item.quantity, 0);
  const amount = getPOSTotal(resolved.items);
  const currency = getPosCurrency();

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    capture_method: parsed.captureMethod,
    payment_method_types: ["card_present"],
    metadata: {
      source: "laem_pos_terminal",
      cart: payloadValidation.cartMetadata,
      quantity_total: String(totalQuantity),
      ...(singleSlug ? { slug: singleSlug } : {})
    }
  });

  if (!paymentIntent.client_secret) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch((error) => {
      console.error("Unable to cancel payment intent without client secret", {
        paymentIntentId: paymentIntent.id,
        error
      });
    });
    return jsonError("Unable to create payment intent", 500, rateLimitHeaders);
  }

  const expiresAt = Math.floor(Date.now() / 1000) + getCheckoutReservationTtlSeconds();
  const reservation = await reserveInventoryForCheckoutSession(paymentIntent.id, resolved.items, expiresAt);

  if (!reservation.ok) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch((error) => {
      console.error("Unable to cancel payment intent after reservation failure", {
        paymentIntentId: paymentIntent.id,
        error
      });
    });

    const errorMessage =
      reservation.reason === "insufficient_stock" && reservation.failedSlug
        ? formatReservationError(reservation.failedSlug, Math.max(0, reservation.available || 0))
        : "Unable to reserve inventory";
    const status = reservation.reason === "insufficient_stock" ? 409 : 500;
    return jsonError(errorMessage, status, rateLimitHeaders);
  }

  return NextResponse.json(
    {
      ok: true,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount,
      currency,
      captureMethod: paymentIntent.capture_method,
      expiresAt
    },
    {
      headers: rateLimitHeaders
    }
  );
}
