import Stripe from "stripe";

import { releaseInventoryReservation } from "@/lib/inventory";

export const runtime = "nodejs";

const CHECKOUT_SESSION_COOKIE = "laem_checkout_session";

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

function clearCheckoutCookieHeader() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CHECKOUT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export async function POST(request: Request) {
  const sessionId = readCookieValue(request.headers.get("cookie"), CHECKOUT_SESSION_COOKIE);
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return Response.json(
      { ok: true, released: false },
      {
        headers: {
          "set-cookie": clearCheckoutCookieHeader()
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
        "set-cookie": clearCheckoutCookieHeader()
      }
    }
  );
}
