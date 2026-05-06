import { NextResponse } from "next/server";

import { sendCashReceiptEmail } from "@/lib/email";
import { readOrder, writeOrder } from "@/lib/orders";
import { requirePOSOrThrow } from "@/lib/require-pos";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

type ParsedRequest = {
  orderId: string;
  email: string;
};

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function isValidEmail(value: string) {
  return value.length <= 320 && value.includes("@") && value.includes(".");
}

async function parseRequest(request: Request): Promise<ParsedRequest | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!orderId || !isValidEmail(email)) {
    return null;
  }

  return {
    orderId,
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

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "pos-cash-receipt",
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

  const parsed = await parseRequest(request);
  if (!parsed) {
    return jsonError("Invalid request payload", 400, rateLimitHeaders);
  }

  const order = await readOrder(parsed.orderId, { skipPiiRetention: true });
  if (!order) {
    return jsonError("Cash order not found.", 404, rateLimitHeaders);
  }
  if (order.channel !== "cash") {
    return jsonError("This receipt endpoint is only for cash POS orders.", 409, rateLimitHeaders);
  }
  if (order.status === "canceled" || order.status === "refunded") {
    return jsonError("Cannot send receipt for a canceled order.", 409, rateLimitHeaders);
  }

  const updatedOrder = {
    ...order,
    email: parsed.email
  };

  await sendCashReceiptEmail({
    orderId: updatedOrder.id,
    customerEmail: parsed.email,
    amountTotal: updatedOrder.amount_total,
    currency: updatedOrder.currency
  });
  await writeOrder(updatedOrder);

  return NextResponse.json(
    {
      ok: true,
      orderId: updatedOrder.id,
      receiptEmail: parsed.email
    },
    {
      headers: rateLimitHeaders
    }
  );
}
