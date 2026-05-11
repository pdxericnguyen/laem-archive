import { NextResponse } from "next/server";

import { getProduct } from "@/lib/inventory";
import { getTodayLaemDateRangeUnix } from "@/lib/laem-time";
import { listRecentOrders, type OrderRecord } from "@/lib/orders";
import { requirePOSOrThrow } from "@/lib/require-pos";

export const runtime = "nodejs";

function getPeriodRange(period: string | null) {
  const nowUnix = Math.floor(Date.now() / 1000);
  if (period === "week") {
    return {
      fromUnix: nowUnix - 7 * 24 * 60 * 60,
      toUnix: nowUnix
    };
  }

  const today = getTodayLaemDateRangeUnix();
  return {
    fromUnix: today?.startUnix ?? nowUnix - 24 * 60 * 60,
    toUnix: today?.endUnix ?? nowUnix
  };
}

function getOrderLineItems(order: OrderRecord) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items;
  }
  if (order.slug) {
    return [
      {
        slug: order.slug,
        quantity: Math.max(1, Math.floor(order.quantity || 1))
      }
    ];
  }
  return [];
}

async function toTransactionRow(order: OrderRecord) {
  const items = await Promise.all(
    getOrderLineItems(order).map(async (item) => {
      const product = await getProduct(item.slug);
      return {
        slug: item.slug,
        title: product?.title || item.slug,
        quantity: Math.max(1, Math.floor(item.quantity || 1))
      };
    })
  );

  return {
    id: order.id,
    channel: order.channel || "checkout",
    status: order.status,
    created: order.created,
    amountTotal: order.amount_total,
    currency: order.currency,
    email: order.email,
    quantity: order.quantity,
    items,
    refund: order.refund || null
  };
}

export async function GET(request: Request) {
  try {
    await requirePOSOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const limitRaw = Number(url.searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(75, Math.max(1, Math.floor(limitRaw))) : 50;
  const range = getPeriodRange(period);
  const recentOrders = await listRecentOrders(999);
  const posRows = recentOrders
    .filter(
      (order) =>
        (order.channel === "terminal" || order.channel === "cash") &&
        order.created >= range.fromUnix &&
        order.created <= range.toUnix
    )
    .sort((a, b) => b.created - a.created)
    .slice(0, limit);
  const rows = await Promise.all(posRows.map(toTransactionRow));

  return NextResponse.json({
    ok: true,
    period: period === "week" ? "week" : "today",
    rows
  });
}
