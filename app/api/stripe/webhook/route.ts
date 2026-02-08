import Stripe from "stripe";

import { decrementStockAtomic, getProduct } from "@/lib/inventory";
import { appendOrderToIndex, hasOrder, writeOrder } from "@/lib/orders";
import { sendInventoryAlertEmail, sendOrderReceivedEmail } from "@/lib/email";

export const runtime = "nodejs";

async function getLineItemQuantity(stripe: Stripe, sessionId: string) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100
  });

  return lineItems.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
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

  if (event.type !== "checkout.session.completed") {
    return new Response("Ignored", { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return new Response("Ignored", { status: 200 });
  }

  const sessionId = session.id;
  const orderExists = await hasOrder(sessionId);
  if (orderExists) {
    return new Response("Already processed", { status: 200 });
  }

  const slug = session.metadata?.slug;
  if (!slug) {
    return new Response("Missing slug metadata", { status: 400 });
  }

  const quantity = await getLineItemQuantity(stripe, sessionId);
  const stockResult = await decrementStockAtomic(slug, quantity);
  const customerEmail = session.customer_details?.email ?? null;
  const product = await getProduct(slug);

  if (!stockResult.ok) {
    const conflictOrder = {
      id: sessionId,
      slug,
      email: customerEmail,
      created: session.created ?? Math.floor(Date.now() / 1000),
      quantity,
      status: "stock_conflict" as const,
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null
    };

    await writeOrder(conflictOrder);
    await appendOrderToIndex(sessionId);

    console.error("Insufficient stock during webhook processing", {
      sessionId,
      slug,
      quantity,
      available: stockResult.current
    });

    try {
      await sendInventoryAlertEmail({
        kind: "oversell",
        slug,
        currentStock: stockResult.current,
        previousStock: stockResult.current,
        quantity,
        orderId: sessionId
      });
    } catch (error) {
      console.error("Inventory oversell alert failed", { sessionId, slug, error });
    }

    return new Response("Stock conflict recorded", { status: 200 });
  }

  const orderRecord = {
    id: sessionId,
    slug,
    email: customerEmail,
    created: session.created ?? Math.floor(Date.now() / 1000),
    quantity,
    status: "paid" as const,
    amount_total: session.amount_total ?? null,
    currency: session.currency ?? null,
  };

  await writeOrder(orderRecord);
  await appendOrderToIndex(sessionId);

  if (stockResult.transition) {
    console.warn("Inventory threshold transition", {
      orderId: sessionId,
      slug,
      transition: stockResult.transition,
      previous: stockResult.current,
      next: stockResult.next
    });
    try {
      await sendInventoryAlertEmail({
        kind: stockResult.transition,
        slug,
        currentStock: stockResult.next,
        previousStock: stockResult.current,
        quantity,
        orderId: sessionId
      });
    } catch (error) {
      console.error("Inventory transition alert failed", {
        orderId: sessionId,
        slug,
        transition: stockResult.transition,
        error
      });
    }
  }

  if (orderRecord.email) {
    try {
      await sendOrderReceivedEmail({
        orderId: sessionId,
        customerEmail: orderRecord.email,
        productTitle: product?.title ?? null,
        quantity
      });
    } catch (error) {
      console.error("Order received email failed", {
        orderId: sessionId,
        error
      });
    }
  }

  return new Response("ok", { status: 200 });
}
