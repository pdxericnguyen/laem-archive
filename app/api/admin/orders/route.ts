import { NextResponse } from "next/server";

import { listOrdersPage } from "@/lib/orders";
import type { OrderStatusFilter } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

function getStripeDashboardUrl(sessionId: string, secretKey: string | undefined) {
  const isTest = Boolean(secretKey && secretKey.startsWith("sk_test_"));
  const base = isTest ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  return `${base}/checkout/sessions/${sessionId}`;
}

export async function GET(req: Request) {
  try {
    await requireAdminOrThrow(req);
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") || "25");
  const rawPage = Number(url.searchParams.get("page") || "1");
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 25;
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const statusParam = url.searchParams.get("status");
  const status: OrderStatusFilter =
    statusParam === "paid" || statusParam === "shipped" || statusParam === "stock_conflict"
      ? statusParam
      : "all";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromUnix = fromParam ? Math.floor(new Date(`${fromParam}T00:00:00Z`).getTime() / 1000) : null;
  const toUnix = toParam ? Math.floor(new Date(`${toParam}T23:59:59Z`).getTime() / 1000) : null;

  if ((fromParam && !Number.isFinite(fromUnix ?? NaN)) || (toParam && !Number.isFinite(toUnix ?? NaN))) {
    return NextResponse.json({ ok: false, error: "Invalid date filter" }, { status: 400 });
  }
  if (typeof fromUnix === "number" && typeof toUnix === "number" && fromUnix > toUnix) {
    return NextResponse.json({ ok: false, error: "`from` cannot be after `to`" }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const result = await listOrdersPage({
    limit,
    page,
    status,
    fromUnix,
    toUnix
  });

  const rows = result.rows;
  const responseRows = rows.map((row) => ({
    ...row,
    customer_email: row.email,
    payment_status: row.status,
    stripe_dashboard_url: getStripeDashboardUrl(row.id, secretKey)
  }));

  return NextResponse.json({
    ok: true,
    rows: responseRows,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages
    }
  });
}
