import Stripe from "stripe";

import type { ReservationHoldSummary } from "@/lib/inventory";
import type { OrderRecord } from "@/lib/orders";
import type { Product } from "@/lib/store";

export type ReconciliationStripePayment = {
  id: string;
  channel: "checkout" | "terminal";
  created: number;
  amountTotal: number | null;
  currency: string | null;
  dashboardUrl: string;
};

export type ReconciliationProductState = Pick<Product, "slug" | "title" | "stock" | "published" | "archived"> & {
  stockKey: number;
  holdSummary: ReservationHoldSummary;
};

export type ReconciliationIssue = {
  id: string;
  severity: "high" | "medium" | "low";
  label: string;
  detail: string;
  href?: string;
};

export type ReconciliationSummary = {
  ordersChecked: number;
  stripePaymentsChecked: number;
  activeHoldCount: number;
  activeHeldUnits: number;
  missingOrderPayments: ReconciliationStripePayment[];
  stockConflicts: OrderRecord[];
  stockSnapshotMismatches: ReconciliationProductState[];
  lowStockProducts: ReconciliationProductState[];
  issues: ReconciliationIssue[];
};

function getStripeDashboardUrl(
  objectId: string,
  objectType: "checkout_session" | "payment_intent",
  secretKey: string
) {
  const isTest = secretKey.startsWith("sk_test_");
  const base = isTest ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  if (objectType === "payment_intent") {
    return `${base}/payments/${objectId}`;
  }
  return `${base}/checkout/sessions/${objectId}`;
}

export async function listRecentStripePayments(options: {
  secretKey: string;
  sinceUnix: number;
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 50)));
  const stripe = new Stripe(options.secretKey, {
    apiVersion: "2023-10-16"
  });

  const [sessions, paymentIntents] = await Promise.all([
    stripe.checkout.sessions.list({
      limit,
      created: {
        gte: options.sinceUnix
      }
    }),
    stripe.paymentIntents.list({
      limit,
      created: {
        gte: options.sinceUnix
      }
    })
  ]);

  const checkoutRows: ReconciliationStripePayment[] = sessions.data
    .filter((session) => session.payment_status === "paid")
    .map((session) => ({
      id: session.id,
      channel: "checkout" as const,
      created: session.created,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
      dashboardUrl: getStripeDashboardUrl(session.id, "checkout_session", options.secretKey)
    }));

  const terminalRows: ReconciliationStripePayment[] = paymentIntents.data
    .filter(
      (paymentIntent) =>
        paymentIntent.status === "succeeded" &&
        paymentIntent.metadata?.source === "laem_pos_terminal"
    )
    .map((paymentIntent) => ({
      id: paymentIntent.id,
      channel: "terminal" as const,
      created: paymentIntent.created,
      amountTotal: paymentIntent.amount_received || paymentIntent.amount || null,
      currency: paymentIntent.currency ?? null,
      dashboardUrl: getStripeDashboardUrl(paymentIntent.id, "payment_intent", options.secretKey)
    }));

  return [...checkoutRows, ...terminalRows].sort((a, b) => b.created - a.created);
}

export function buildReconciliationSummary(input: {
  orders: OrderRecord[];
  stripePayments: ReconciliationStripePayment[];
  products: ReconciliationProductState[];
  lowStockThreshold: number;
}): ReconciliationSummary {
  const orderIds = new Set(input.orders.map((order) => order.id));
  const missingOrderPayments = input.stripePayments.filter((payment) => !orderIds.has(payment.id));
  const stockConflicts = input.orders.filter((order) => order.status === "stock_conflict");
  const stockSnapshotMismatches = input.products.filter((product) => product.stock !== product.stockKey);
  const lowStockProducts = input.products.filter(
    (product) =>
      product.published &&
      !product.archived &&
      product.stockKey > 0 &&
      product.stockKey <= input.lowStockThreshold
  );
  const activeHoldCount = input.products.reduce(
    (sum, product) => sum + product.holdSummary.activeCheckoutCount,
    0
  );
  const activeHeldUnits = input.products.reduce(
    (sum, product) => sum + product.holdSummary.reservedStock,
    0
  );

  const issues: ReconciliationIssue[] = [
    ...missingOrderPayments.map((payment) => ({
      id: `missing-order-${payment.id}`,
      severity: "high" as const,
      label: `${payment.channel === "terminal" ? "POS" : "Stripe Checkout"} payment missing LAEM order`,
      detail: `${payment.id} is paid in Stripe but was not found in the LAEM order index checked here.`,
      href: payment.dashboardUrl
    })),
    ...stockConflicts.map((order) => ({
      id: `stock-conflict-${order.id}`,
      severity: "high" as const,
      label: "Paid order has stock conflict",
      detail: `${order.id} could not fully decrement stock. Resolve before fulfillment.`,
      href: `/admin/orders?queue=conflicts`
    })),
    ...stockSnapshotMismatches.map((product) => ({
      id: `stock-mismatch-${product.slug}`,
      severity: "medium" as const,
      label: "Product stock snapshot mismatch",
      detail: `${product.slug} shows ${product.stock} on product data but ${product.stockKey} in the live stock key.`,
      href: `/admin/reconciliation?slug=${encodeURIComponent(product.slug)}`
    }))
  ];

  if (activeHeldUnits > 0) {
    issues.push({
      id: "active-holds",
      severity: "low",
      label: "Inventory currently held in checkout",
      detail: `${activeHeldUnits} unit${activeHeldUnits === 1 ? "" : "s"} held across ${activeHoldCount} active checkout hold${activeHoldCount === 1 ? "" : "s"}.`
    });
  }

  return {
    ordersChecked: input.orders.length,
    stripePaymentsChecked: input.stripePayments.length,
    activeHoldCount,
    activeHeldUnits,
    missingOrderPayments,
    stockConflicts,
    stockSnapshotMismatches,
    lowStockProducts,
    issues: issues.sort((a, b) => {
      const weight = { high: 0, medium: 1, low: 2 };
      return weight[a.severity] - weight[b.severity];
    })
  };
}
