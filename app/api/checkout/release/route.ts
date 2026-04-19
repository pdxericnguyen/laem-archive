import Stripe from "stripe";

import {
  CHECKOUT_SESSION_COOKIE,
  clearCheckoutSessionCookieHeader,
  isAllowedRequestOrigin,
  isCheckoutSessionId,
  readCookieValue,
  shouldEnforceCheckoutOriginGuard
} from "@/lib/checkout-session";
import { releaseInventoryReservation } from "@/lib/inventory";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const siteUrl = process.env.SITE_URL;
  if (
    siteUrl &&
    shouldEnforceCheckoutOriginGuard() &&
    !isAllowedRequestOrigin(request.headers.get("origin"), siteUrl)
  ) {
    return Response.json(
      { ok: false, error: "Invalid request origin" },
      {
        status: 403,
        headers: {
          "set-cookie": clearCheckoutSessionCookieHeader()
        }
      }
    );
  }

  const sessionId = readCookieValue(request.headers.get("cookie"), CHECKOUT_SESSION_COOKIE);
  if (!isCheckoutSessionId(sessionId)) {
    return Response.json(
      { ok: true, released: false },
      {
        headers: {
          "set-cookie": clearCheckoutSessionCookieHeader()
        }
      }
    );
  }

  await releaseInventoryReservation(sessionId, "released");

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16"
    });
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch {
      // Ignore: session may already be completed/expired/canceled.
    }
  }

  return Response.json(
    { ok: true, released: true },
    {
      headers: {
        "set-cookie": clearCheckoutSessionCookieHeader()
      }
    }
  );
}
