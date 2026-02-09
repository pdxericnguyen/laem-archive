import Stripe from "stripe";

import { getProduct, getStock } from "@/lib/inventory";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

type CheckoutItem = {
  slug: string;
  quantity: number;
};

type ParsedCheckoutRequest = {
  items: CheckoutItem[];
  wantsJson: boolean;
};

function normalizeSiteUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
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

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const requested of items) {
    const product = await getProduct(requested.slug);
    if (!product || !product.published || product.archived) {
      const errorMessage = `Product not found: ${requested.slug}`;
      return wantsJson
        ? jsonResponse({ ok: false, error: errorMessage }, 404, rateLimitHeaders)
        : new Response(errorMessage, { status: 404, headers: rateLimitHeaders });
    }

    const stock = await getStock(requested.slug);
    if (!stock || stock <= 0) {
      const errorMessage = `Out of stock: ${requested.slug}`;
      return wantsJson
        ? jsonResponse({ ok: false, error: errorMessage }, 400, rateLimitHeaders)
        : new Response(errorMessage, { status: 400, headers: rateLimitHeaders });
    }

    if (requested.quantity > stock) {
      const errorMessage = `Requested quantity exceeds stock for ${requested.slug}`;
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
  const successUrl = singleSlug
    ? `${baseUrl}/products/${singleSlug}?success=1&session_id={CHECKOUT_SESSION_ID}`
    : `${baseUrl}/cart?success=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = singleSlug
    ? `${baseUrl}/products/${singleSlug}?canceled=1`
    : `${baseUrl}/cart?canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lineItems,
    metadata: {
      cart: serializeCartMetadata(items),
      ...(singleSlug ? { slug: singleSlug } : {})
    }
  });

  if (!session.url) {
    const errorMessage = "Unable to create checkout session";
    return wantsJson
      ? jsonResponse({ ok: false, error: errorMessage }, 500, rateLimitHeaders)
      : new Response(errorMessage, { status: 500, headers: rateLimitHeaders });
  }

  if (wantsJson) {
    return jsonResponse({ ok: true, url: session.url }, 200, rateLimitHeaders);
  }

  return Response.redirect(session.url, 303);
}
