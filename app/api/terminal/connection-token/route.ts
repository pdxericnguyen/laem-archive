import { NextResponse } from "next/server";
import Stripe from "stripe";

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

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "terminal-connection-token",
    limit: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_MAX, 20),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS, 60)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many terminal token requests. Try again shortly." },
      { status: 429, headers: rateLimitHeaders }
    );
  }

  try {
    await requirePOSOrThrow(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: rateLimitHeaders }
    );
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return NextResponse.json(
      { ok: false, error: "Missing STRIPE_SECRET_KEY" },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  const token = await stripe.terminal.connectionTokens.create();

  return NextResponse.json(
    {
      ok: true,
      secret: token.secret,
      location: process.env.STRIPE_TERMINAL_LOCATION_ID || null
    },
    {
      headers: rateLimitHeaders
    }
  );
}
