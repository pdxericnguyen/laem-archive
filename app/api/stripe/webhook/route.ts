import Stripe from "stripe";

import {
  decrementMultipleStockAtomic,
  getProduct,
  syncProductStockAndArchiveState,
  type StockRequest
} from "@/lib/inventory";
import { appendOrderToIndex, hasOrder, writeOrder } from "@/lib/orders";
import { sendInventoryAlertEmail, sendOrderReceivedEmail } from "@/lib/email";

export const runtime = "nodejs";

function parseCartMetadata(cartValue: string | null | undefined): StockRequest[] {
  if (!cartValue || typeof cartValue !== "string") {
    return [];
  }

  const items = cartValue
    .split(",")
    .map((entry) => {
      const [slugRaw, qtyRaw] = entry.split(":");
      const slug = (slugRaw || "").trim();
      const quantity = Number(qtyRaw || "0");
      if (!slug || !Number.isFinite(quantity) || quantity <= 0) {
        return null;
      }
      return {
        slug,
        quantity: Math.max(1, Math.floor(quantity))
      };
    })
    .filter((row): row is StockRequest => Boolean(row));

  return items;
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

  const purchasedItems = await getPurchasedItems(stripe, session);
  if (purchasedItems.length === 0) {
    return new Response("Missing cart metadata", { status: 400 });
  }

  const stockResult = await decrementMultipleStockAtomic(purchasedItems);
  const customerEmail = session.customer_details?.email ?? null;
  const totalQuantity = purchasedItems.reduce((sum, item) => sum + item.quantity, 0);
  const primarySlug = purchasedItems[0]?.slug || null;

  if (!stockResult.ok) {
    const failedSlug = stockResult.failedSlug ?? primarySlug;
    const failedItem = stockResult.items[0];
    const available = failedItem ? failedItem.current : 0;

    const conflictOrder = {
      id: sessionId,
      slug: failedSlug,
      email: customerEmail,
      created: session.created ?? Math.floor(Date.now() / 1000),
      quantity: totalQuantity,
      items: purchasedItems,
      status: "stock_conflict" as const,
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null
    };

    await writeOrder(conflictOrder);
    await appendOrderToIndex(sessionId);

    console.error("Insufficient stock during webhook processing", {
      sessionId,
      failedSlug,
      requested: purchasedItems,
      available
    });

    try {
      await sendInventoryAlertEmail({
        kind: "oversell",
        slug: failedSlug || "unknown",
        currentStock: available,
        previousStock: available,
        quantity: totalQuantity,
        orderId: sessionId
      });
    } catch (error) {
      console.error("Inventory oversell alert failed", { sessionId, slug: failedSlug, error });
    }

    return new Response("Stock conflict recorded", { status: 200 });
  }

  for (const item of stockResult.items) {
    await syncProductStockAndArchiveState(item.slug, item.next);
  }

  const orderRecord = {
    id: sessionId,
    slug: primarySlug,
    email: customerEmail,
    created: session.created ?? Math.floor(Date.now() / 1000),
    quantity: totalQuantity,
    items: purchasedItems,
    status: "paid" as const,
    amount_total: session.amount_total ?? null,
    currency: session.currency ?? null
  };

  await writeOrder(orderRecord);
  await appendOrderToIndex(sessionId);

  for (const item of stockResult.items) {
    if (!item.transition) {
      continue;
    }
    console.warn("Inventory threshold transition", {
      orderId: sessionId,
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
        orderId: sessionId
      });
    } catch (error) {
      console.error("Inventory transition alert failed", {
        orderId: sessionId,
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
        orderId: sessionId,
        customerEmail: orderRecord.email,
        productTitle: firstProduct?.title ?? null,
        quantity: totalQuantity
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
