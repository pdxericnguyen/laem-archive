import Stripe from "stripe";

import {
  cleanupExpiredInventoryReservations,
  getAvailableStock,
  getCheckoutReservationTtlSeconds,
  getProduct,
  releaseInventoryReservation,
  reserveInventoryForCheckoutSession
} from "@/lib/inventory";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
const CHECKOUT_SESSION_COOKIE = "laem_checkout_session";

type CheckoutItem = {
  slug: string;
  quantity: number;
};

type ParsedCheckoutRequest = {
  items: CheckoutItem[];
  wantsJson: boolean;
};

type ShippingAllowedCountry = Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry;

function normalizeSiteUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function readCookieValue(cookieHeader: string | null | undefined, keyName: string) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part.startsWith(`${keyName}=`)) {
      continue;
    }
    const value = part.slice(keyName.length + 1).trim();
    return value || null;
  }
  return null;
}

function buildCheckoutSessionCookie(sessionId: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = Math.max(60, Math.floor(maxAgeSeconds));
  return `${CHECKOUT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

async function releasePreviousCheckoutReservation(
  stripe: Stripe,
  request: Request
) {
  const priorSessionId = readCookieValue(request.headers.get("cookie"), CHECKOUT_SESSION_COOKIE);
  if (!priorSessionId || !priorSessionId.startsWith("cs_")) {
    return;
  }

  await releaseInventoryReservation(priorSessionId, "released");
  try {
    await stripe.checkout.sessions.expire(priorSessionId);
  } catch {
    // Ignore: session may already be completed/expired/canceled.
  }
}

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function getShippingAddressAllowedCountries() {
  const configured = (process.env.STRIPE_SHIPPING_ALLOWED_COUNTRIES || "US")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  if (configured.length === 0) {
    return ["US" as ShippingAllowedCountry];
  }

  return [...new Set(configured)] as ShippingAllowedCountry[];
}

function normalizeItem(rawSlug: unknown, rawQuantity: unknown): CheckoutItem | null {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  const quantity = typeof rawQuantity === "number" ? rawQuantity : Number(rawQuantity ?? 1);
  if (!slug || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  return {
    slug,
    quantity: Math.max(1, Math.floor(quantity))
  };
}

function collapseItems(items: CheckoutItem[]) {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.slug, (map.get(item.slug) || 0) + item.quantity);
  }
  return [...map.entries()].map(([slug, quantity]) => ({
    slug,
    quantity
  }));
}

async function parseCheckoutRequest(request: Request): Promise<ParsedCheckoutRequest | null> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }

    if (Array.isArray(body.items)) {
      const items = body.items
        .map((row) => {
          if (!row || typeof row !== "object") {
            return null;
          }
          const item = row as Record<string, unknown>;
          return normalizeItem(item.slug, item.quantity);
        })
        .filter((row): row is CheckoutItem => Boolean(row));

      return {
        items: collapseItems(items),
        wantsJson: true
      };
    }

    const single = normalizeItem(body.slug, body.quantity);
    return {
      items: single ? [single] : [],
      wantsJson: true
    };
  }

  const formData = await request.formData();
  const slug = formData.get("slug");
  const quantity = formData.get("quantity");
  const single = normalizeItem(slug, quantity);
  return {
    items: single ? [single] : [],
    wantsJson: false
  };
}

function serializeCartMetadata(items: CheckoutItem[]) {
  return items.map((item) => `${item.slug}:${item.quantity}`).join(",");
}

function jsonResponse(payload: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "content-type": "application/json"
    }
  });
}

function formatAvailabilityError(slug: string, available: number) {
  if (available <= 0) {
    return `Out of stock: ${slug}`;
  }
  if (available === 1) {
    return `Only 1 left for ${slug}`;
  }
  return `Only ${available} left for ${slug}`;
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "checkout",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);
  if (!rateLimit.ok) {
    return new Response("Too many checkout attempts. Try again shortly.", {
      status: 429,
      headers: rateLimitHeaders
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = process.env.SITE_URL;

  if (!stripeSecretKey) {
    return new Response("Missing STRIPE_SECRET_KEY", { status: 500, headers: rateLimitHeaders });
  }

  if (!siteUrl) {
    return new Response("Missing SITE_URL", { status: 500, headers: rateLimitHeaders });
  }

  const parsed = await parseCheckoutRequest(request);
  if (!parsed) {
    return new Response("Invalid request payload", { status: 400, headers: rateLimitHeaders });
  }

  const { items, wantsJson } = parsed;
  if (items.length === 0) {
    const errorMessage = "Missing items";
    return wantsJson
      ? jsonResponse({ ok: false, error: errorMessage }, 400, rateLimitHeaders)
      : new Response(errorMessage, { status: 400, headers: rateLimitHeaders });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  await releasePreviousCheckoutReservation(stripe, request);
  await cleanupExpiredInventoryReservations();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const requested of items) {
    const product = await getProduct(requested.slug);
    if (!product || !product.published || product.archived) {
      const errorMessage = `Product not found: ${requested.slug}`;
      return wantsJson
        ? jsonResponse({ ok: false, error: errorMessage }, 404, rateLimitHeaders)
        : new Response(errorMessage, { status: 404, headers: rateLimitHeaders });
    }

    const available = await getAvailableStock(requested.slug);
    if (!available || available <= 0) {
      const errorMessage = formatAvailabilityError(requested.slug, 0);
      return wantsJson
        ? jsonResponse({ ok: false, error: errorMessage }, 400, rateLimitHeaders)
        : new Response(errorMessage, { status: 400, headers: rateLimitHeaders });
    }

    if (requested.quantity > available) {
      const errorMessage = formatAvailabilityError(requested.slug, available);
      return wantsJson
        ? jsonResponse({ ok: false, error: errorMessage }, 400, rateLimitHeaders)
        : new Response(errorMessage, { status: 400, headers: rateLimitHeaders });
    }

    const lineItem = product.priceId
      ? {
          price: product.priceId,
          quantity: requested.quantity
        }
      : {
          quantity: requested.quantity,
          price_data: {
            currency: "usd",
            unit_amount: product.priceCents,
            product_data: {
              name: product.title,
              description: product.description || product.subtitle
            }
          }
        };
    lineItems.push(lineItem);
  }

  const baseUrl = normalizeSiteUrl(siteUrl);
  const singleSlug = items.length === 1 ? items[0].slug : null;
  const successUrl = `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = singleSlug
    ? `${baseUrl}/products/${singleSlug}?canceled=1`
    : `${baseUrl}/cart?canceled=1`;
  const expiresAt = Math.floor(Date.now() / 1000) + getCheckoutReservationTtlSeconds();

  let session: Stripe.Checkout.Session;

  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: expiresAt,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: getShippingAddressAllowedCountries()
      },
      line_items: lineItems,
      metadata: {
        cart: serializeCartMetadata(items),
        ...(singleSlug ? { slug: singleSlug } : {})
      }
    });
  } catch (error) {
    console.error("Stripe checkout session creation failed", {
      error,
      items,
      siteUrl
    });
    return wantsJson
      ? jsonResponse({ ok: false, error: "Unable to create checkout session" }, 500, rateLimitHeaders)
      : new Response("Unable to create checkout session", { status: 500, headers: rateLimitHeaders });
  }

  const reservation = await reserveInventoryForCheckoutSession(session.id, items, session.expires_at || expiresAt);
  if (!reservation.ok) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      console.error("Unable to expire checkout session after reservation failure", {
        sessionId: session.id,
        error
      });
    }

    const available = Math.max(0, Math.floor(reservation.available || 0));
    const failedSlug = reservation.failedSlug || items[0]?.slug || "item";
    const errorMessage = formatAvailabilityError(failedSlug, available);
    return wantsJson
      ? jsonResponse({ ok: false, error: errorMessage }, 409, rateLimitHeaders)
      : new Response(errorMessage, { status: 409, headers: rateLimitHeaders });
  }

  if (!session.url) {
    await releaseInventoryReservation(session.id);
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      console.error("Unable to expire checkout session without session url", {
        sessionId: session.id,
        error
      });
    }
    const errorMessage = "Unable to create checkout session";
    return wantsJson
      ? jsonResponse({ ok: false, error: errorMessage }, 500, rateLimitHeaders)
      : new Response(errorMessage, { status: 500, headers: rateLimitHeaders });
  }

  if (wantsJson) {
    return jsonResponse(
      { ok: true, url: session.url },
      200,
      {
        ...rateLimitHeaders,
        "set-cookie": buildCheckoutSessionCookie(session.id, getCheckoutReservationTtlSeconds())
      }
    );
  }

  return new Response(null, {
    status: 303,
    headers: {
      ...rateLimitHeaders,
      location: session.url,
      "set-cookie": buildCheckoutSessionCookie(session.id, getCheckoutReservationTtlSeconds())
    }
  });
}
