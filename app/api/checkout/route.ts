import Stripe from "stripe";

import { getProduct, getStock } from "@/lib/inventory";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

function normalizeSiteUrl(url: string) {
  return url.replace(/\/+$/, "");
}

async function getSlug(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    return typeof body?.slug === "string" ? body.slug : null;
  }

  const formData = await request.formData();
  const slug = formData.get("slug");
  return typeof slug === "string" ? slug : null;
}

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
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

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  const slug = await getSlug(request);
  if (!slug) {
    return new Response("Missing slug", { status: 400, headers: rateLimitHeaders });
  }

  const product = await getProduct(slug);
  if (!product || !product.published || product.archived) {
    return new Response("Product not found", { status: 404, headers: rateLimitHeaders });
  }

  const stock = await getStock(slug);
  if (!stock || stock <= 0) {
    return new Response("Out of stock", { status: 400, headers: rateLimitHeaders });
  }

  const baseUrl = normalizeSiteUrl(siteUrl);
  const lineItem = product.priceId
    ? {
        price: product.priceId,
        quantity: 1,
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
          maximum: stock
        }
      }
    : {
        quantity: 1,
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
          maximum: stock
        },
        price_data: {
          currency: "usd",
          unit_amount: product.priceCents,
          product_data: {
            name: product.title,
            description: product.description || product.subtitle
          }
        }
      };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${baseUrl}/products/${slug}?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/products/${slug}?canceled=1`,
    line_items: [lineItem],
    metadata: { slug }
  });

  if (!session.url) {
    return new Response("Unable to create checkout session", { status: 500, headers: rateLimitHeaders });
  }

  return Response.redirect(session.url, 303);
}
