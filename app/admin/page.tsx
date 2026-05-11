import AdminCommandPalette from "./command-palette";
import AdminSystemHealthBanner from "./system-health-banner";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { readOrder, type OrderRecord } from "@/lib/orders";
import { getLowStockThreshold, getStock, summarizeReservationHoldsForSlugs } from "@/lib/inventory";
import { getTodayLaemDateRangeUnix } from "@/lib/laem-time";

export const metadata = { title: "Admin | LAEM Archive" };
export const dynamic = "force-dynamic";

type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "high" | "medium" | "low";
};

function getAttentionToneClass(tone: AttentionItem["tone"]) {
  if (tone === "high") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  if (tone === "medium") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-neutral-300 bg-neutral-50 text-neutral-800";
}

async function getDashboardStats() {
  if (!hasKvEnv()) {
    return {
      paidToday: 0,
      unfulfilled: 0,
      lowStock: 0,
      printFailures: 0,
      attentionItems: []
    };
  }

  const todayRange = getTodayLaemDateRangeUnix();
  const startOfDayUnix = todayRange?.startUnix || Math.floor(Date.now() / 1000);

  const orderIds = (await kv.lrange<string>(key.ordersIndex, 0, 399)) || [];
  const orders = (await Promise.all(orderIds.map((id) => readOrder(id)))).filter(
    (order): order is OrderRecord => Boolean(order)
  );

  const paidToday = orders.filter((order) => order.status === "paid" && order.created >= startOfDayUnix).length;
  const paidUnfulfilledOrders = orders.filter((order) => order.status === "paid");
  const printFailureOrders = orders.filter(
    (order) =>
      order.printing?.packingSlip?.status === "failed" || order.printing?.shippingLabel?.status === "failed"
  );
  const stockConflictOrders = orders.filter((order) => order.status === "stock_conflict");
  const addressMissingOrders = paidUnfulfilledOrders.filter(
    (order) => order.channel === "checkout" && !order.shippingAddress?.line1
  );

  const products = ((await kv.get<Array<{ slug?: string }>>(key.products)) || []).filter(
    (product): product is { slug: string } => typeof product?.slug === "string" && product.slug.length > 0
  );
  const lowStockThreshold = getLowStockThreshold();
  const [stockRows, holdSummariesBySlug] = await Promise.all([
    Promise.all(products.map(async (product) => [product.slug, await getStock(product.slug)] as const)),
    summarizeReservationHoldsForSlugs(products.map((product) => product.slug))
  ]);
  const lowStockProducts = stockRows.filter(([, stock]) => stock > 0 && stock <= lowStockThreshold);
  const activeHeldUnits = Object.values(holdSummariesBySlug).reduce(
    (sum, summary) => sum + summary.reservedStock,
    0
  );

  const attentionItems: AttentionItem[] = [
    ...(stockConflictOrders.length > 0
      ? [
          {
            id: "stock-conflicts",
            label: "Stock conflicts",
            detail: `${stockConflictOrders.length} paid order${
              stockConflictOrders.length === 1 ? "" : "s"
            } need a resolve or refund decision before shipping.`,
            href: "/admin/orders?queue=conflicts",
            tone: "high" as const
          }
        ]
      : []),
    ...(printFailureOrders.length > 0
      ? [
          {
            id: "print-failures",
            label: "Print failed",
            detail: `${printFailureOrders.length} order${
              printFailureOrders.length === 1 ? "" : "s"
            } need packing slip or shipping label retry.`,
            href: "/admin/orders?queue=print_failed",
            tone: "high" as const
          }
        ]
      : []),
    ...(addressMissingOrders.length > 0
      ? [
          {
            id: "address-missing",
            label: "Address missing",
            detail: `${addressMissingOrders.length} checkout order${
              addressMissingOrders.length === 1 ? "" : "s"
            } need a shipping address before fulfillment.`,
            href: "/admin/orders?queue=address_missing",
            tone: "medium" as const
          }
        ]
      : []),
    ...(paidUnfulfilledOrders.length > 0
      ? [
          {
            id: "awaiting-shipment",
            label: "Awaiting shipment",
            detail: `${paidUnfulfilledOrders.length} paid order${
              paidUnfulfilledOrders.length === 1 ? "" : "s"
            } ready for fulfillment.`,
            href: "/admin/orders?queue=paid_unfulfilled",
            tone: "medium" as const
          }
        ]
      : []),
    ...(lowStockProducts.length > 0
      ? [
          {
            id: "low-stock",
            label: "Low stock",
            detail: `${lowStockProducts.length} live product${
              lowStockProducts.length === 1 ? "" : "s"
            } at or below ${lowStockThreshold}.`,
            href: "/admin/products?status=live",
            tone: "low" as const
          }
        ]
      : []),
    ...(activeHeldUnits > 0
      ? [
          {
            id: "checkout-holds",
            label: "Checkout holds active",
            detail: `${activeHeldUnits} unit${
              activeHeldUnits === 1 ? "" : "s"
            } temporarily reserved by in-progress checkout.`,
            href: "/admin/products",
            tone: "low" as const
          }
        ]
      : [])
  ];

  return {
    paidToday,
    unfulfilled: paidUnfulfilledOrders.length,
    lowStock: lowStockProducts.length,
    printFailures: printFailureOrders.length,
    attentionItems
  };
}

export default async function AdminHome() {
  const stats = await getDashboardStats();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <AdminSystemHealthBanner />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
        <form action="/api/admin/auth/logout" method="POST">
          <button className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50">
            Sign out
          </button>
        </form>
      </div>
      <AdminCommandPalette />
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Needs Attention</h2>
            <p className="text-xs text-neutral-500">Only the things that may need a decision or a retry.</p>
          </div>
          <a
            href="/admin/orders"
            className="inline-flex h-9 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Open Orders
          </a>
        </div>
        {stats.attentionItems.length === 0 ? (
          <div className="border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            No admin action needed right now.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {stats.attentionItems.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`border px-3 py-3 text-sm no-underline hover:brightness-95 ${getAttentionToneClass(item.tone)}`}
              >
                <span className="block font-semibold">{item.label}</span>
                <span className="mt-1 block">{item.detail}</span>
              </a>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Paid Today</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{stats.paidToday}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Unfulfilled</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{stats.unfulfilled}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Low Stock</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{stats.lowStock}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Print Failures</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{stats.printFailures}</p>
        </div>
      </div>
      <div className="grid gap-3 text-sm">
        <a
          className="border border-neutral-300 px-4 h-11 inline-flex items-center no-underline hover:bg-neutral-50"
          href="/admin/products"
        >
          Products
        </a>
        <a
          className="border border-neutral-300 px-4 h-11 inline-flex items-center no-underline hover:bg-neutral-50"
          href="/admin/orders"
        >
          Orders
        </a>
        <a
          className="border border-neutral-300 px-4 h-11 inline-flex items-center no-underline hover:bg-neutral-50"
          href="/admin/visuals"
        >
          Site Visuals
        </a>
      </div>
    </main>
  );
}
