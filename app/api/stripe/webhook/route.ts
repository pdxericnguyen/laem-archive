import Stripe from "stripe";

import {
  consumeInventoryReservation,
  decrementMultipleStockAtomic,
  getProduct,
  releaseInventoryReservation,
  syncProductStockAndArchiveState,
  type StockRequest
} from "@/lib/inventory";
import { appendOrderToIndex, hasOrder, writeOrder, type OrderChannel, type StripeObjectType } from "@/lib/orders";
import { sendInventoryAlertEmail, sendOrderReceivedEmail } from "@/lib/email";

export const runtime = "nodejs";

function asPositiveInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeCartItem(rawSlug: unknown, rawQuantity: unknown): StockRequest | null {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  const quantity =
    rawQuantity === undefined || rawQuantity === null || rawQuantity === ""
      ? 1
      : asPositiveInt(rawQuantity, 0);
  if (!slug || quantity <= 0) {
    return null;
  }
  return {
    slug,
    quantity
  };
}

function collapseCartItems(items: StockRequest[]) {
  const grouped = new Map<string, number>();
  for (const item of items) {
    grouped.set(item.slug, (grouped.get(item.slug) || 0) + item.quantity);
  }
  return [...grouped.entries()].map(([slug, quantity]) => ({
    slug,
    quantity
  }));
}

function parseCartMetadata(value: string | null | undefined): StockRequest[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  return collapseCartItems(
    value
      .split(",")
      .map((entry) => {
        const [slugRaw, quantityRaw] = entry.split(":");
        return normalizeCartItem(slugRaw, quantityRaw);
      })
      .filter((row): row is StockRequest => Boolean(row))
  );
}

async function getLineItemQuantity(stripe: Stripe, sessionId: string) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100
  });

  return lineItems.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
}

async function getPurchasedItems(stripe: Stripe, session: Stripe.Checkout.Session) {
  const fromMetadata = parseCartMetadata(session.metadata?.cart);
  if (fromMetadata.length > 0) {
    return fromMetadata;
  }

  const slug = session.metadata?.slug;
  if (!slug) {
    return [];
  }

  const quantity = await getLineItemQuantity(stripe, session.id);
  return [
    {
      slug,
      quantity: Math.max(1, quantity)
    }
  ];
}

function isTerminalPOSPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  return paymentIntent.metadata?.source === "laem_pos_terminal";
}

type FinalizeOrderParams = {
  id: string;
  items: StockRequest[];
  email: string | null;
  created: number;
  amountTotal: number | null;
  currency: string | null;
  channel: OrderChannel;
  stripeObjectType: StripeObjectType;
};

async function finalizeSuccessfulOrder(params: FinalizeOrderParams) {
  const orderExists = await hasOrder(params.id);
  if (orderExists) {
    return "duplicate" as const;
  }

  const stockResult =
    (await consumeInventoryReservation(params.id)) || (await decrementMultipleStockAtomic(params.items));
  const totalQuantity = params.items.reduce((sum, item) => sum + item.quantity, 0);
  const primarySlug = params.items[0]?.slug || null;

  if (!stockResult.ok) {
    const failedSlug = stockResult.failedSlug ?? primarySlug;
    const failedItem = stockResult.items[0];
    const available = failedItem ? failedItem.current : 0;

    const conflictOrder = {
      id: params.id,
      slug: failedSlug,
      email: params.email,
      created: params.created,
      quantity: totalQuantity,
      items: params.items,
      status: "stock_conflict" as const,
      amount_total: params.amountTotal,
      currency: params.currency,
      channel: params.channel,
      stripeObjectType: params.stripeObjectType
    };

    await writeOrder(conflictOrder);
    await appendOrderToIndex(params.id);

    console.error("Insufficient stock during webhook processing", {
      orderId: params.id,
      failedSlug,
      requested: params.items,
      available,
      channel: params.channel
    });

    try {
      await sendInventoryAlertEmail({
        kind: "oversell",
        slug: failedSlug || "unknown",
        currentStock: available,
        previousStock: available,
        quantity: totalQuantity,
        orderId: params.id
      });
    } catch (error) {
      console.error("Inventory oversell alert failed", {
        orderId: params.id,
        slug: failedSlug,
        error
      });
    }

    return "conflict" as const;
  }

  for (const item of stockResult.items) {
    await syncProductStockAndArchiveState(item.slug, item.next);
  }

  const orderRecord = {
    id: params.id,
    slug: primarySlug,
    email: params.email,
    created: params.created,
    quantity: totalQuantity,
    items: params.items,
    status: "paid" as const,
    amount_total: params.amountTotal,
    currency: params.currency,
    channel: params.channel,
    stripeObjectType: params.stripeObjectType
  };

  await writeOrder(orderRecord);
  await appendOrderToIndex(params.id);

  for (const item of stockResult.items) {
    if (!item.transition) {
      continue;
    }
    console.warn("Inventory threshold transition", {
      orderId: params.id,
      slug: item.slug,
      transition: item.transition,
      previous: item.current,
      next: item.next
    });
    try {
      await sendInventoryAlertEmail({
        kind: item.transition,
        slug: item.slug,
        currentStock: item.next,
        previousStock: item.current,
        quantity: item.requested,
        orderId: params.id
      });
    } catch (error) {
      console.error("Inventory transition alert failed", {
        orderId: params.id,
        slug: item.slug,
        transition: item.transition,
        error
      });
    }
  }

  if (orderRecord.email) {
    const firstProduct = primarySlug ? await getProduct(primarySlug) : null;
    try {
      await sendOrderReceivedEmail({
        orderId: params.id,
        customerEmail: orderRecord.email,
        productTitle: firstProduct?.title ?? null,
        quantity: totalQuantity
      });
    } catch (error) {
      console.error("Order received email failed", {
        orderId: params.id,
        error
      });
    }
  }

  return "processed" as const;
}

export async function POST(request: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey) {
    return new Response("Missing STRIPE_SECRET_KEY", { status: 500 });
  }

  if (!webhookSecret) {
    return new Response("Missing STRIPE_WEBHOOK_SECRET", { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16"
  });

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await releaseInventoryReservation(session.id, "expired");
    return new Response("ok", { status: 200 });
  }

  if (event.type === "payment_intent.canceled" || event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (!isTerminalPOSPaymentIntent(paymentIntent)) {
      return new Response("Ignored", { status: 200 });
    }
    await releaseInventoryReservation(paymentIntent.id);
    return new Response("ok", { status: 200 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (!isTerminalPOSPaymentIntent(paymentIntent)) {
      return new Response("Ignored", { status: 200 });
    }

    const purchasedItems = parseCartMetadata(paymentIntent.metadata?.cart);
    if (purchasedItems.length === 0) {
      return new Response("Missing cart metadata", { status: 400 });
    }

    const outcome = await finalizeSuccessfulOrder({
      id: paymentIntent.id,
      items: purchasedItems,
      email: paymentIntent.receipt_email ?? null,
      created: paymentIntent.created ?? Math.floor(Date.now() / 1000),
      amountTotal: paymentIntent.amount_received || paymentIntent.amount || null,
      currency: paymentIntent.currency ?? null,
      channel: "terminal",
      stripeObjectType: "payment_intent"
    });

    if (outcome === "duplicate") {
      return new Response("Already processed", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response("Ignored", { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return new Response("Ignored", { status: 200 });
  }

  const purchasedItems = await getPurchasedItems(stripe, session);
  if (purchasedItems.length === 0) {
    return new Response("Missing cart metadata", { status: 400 });
  }

  const outcome = await finalizeSuccessfulOrder({
    id: session.id,
    items: purchasedItems,
    email: session.customer_details?.email ?? null,
    created: session.created ?? Math.floor(Date.now() / 1000),
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    channel: "checkout",
    stripeObjectType: "checkout_session"
  });

  if (outcome === "duplicate") {
    return new Response("Already processed", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}
