import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import {
  getLowStockThreshold,
  getStock,
  summarizeReservationHoldsForSlugs
} from "@/lib/inventory";
import {
  describeInventoryLedgerEvent,
  listInventoryLedgerEvents,
  type InventoryLedgerEvent
} from "@/lib/inventory-ledger";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { listRecentOrders } from "@/lib/orders";
import {
  buildReconciliationSummary,
  listRecentStripePayments,
  type ReconciliationProductState,
  type ReconciliationStripePayment
} from "@/lib/reconciliation";
import type { Product } from "@/lib/store";

export const metadata = { title: "Reconciliation | Admin" };
export const dynamic = "force-dynamic";

type AdminReconciliationPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function parseSlug(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw.trim() || null;
}

function formatDate(unix: number | undefined) {
  if (!unix) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(unix * 1000));
}

function formatSigned(value: number | undefined) {
  if (typeof value !== "number") {
    return "-";
  }
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function severityClass(severity: "high" | "medium" | "low") {
  if (severity === "high") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  if (severity === "medium") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-neutral-300 bg-neutral-50 text-neutral-800";
}

function getEventTone(event: InventoryLedgerEvent) {
  if (event.kind === "stock_conflict") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  if (event.kind === "stock_sold" || event.kind === "reservation_completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }
  if (event.kind === "stock_adjusted") {
    return "border-blue-300 bg-blue-50 text-blue-900";
  }
  return "border-neutral-300 bg-neutral-50 text-neutral-800";
}

async function loadStripeRows(sinceUnix: number) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      rows: [] as ReconciliationStripePayment[],
      error: "Stripe check skipped because STRIPE_SECRET_KEY is not configured."
    };
  }

  try {
    return {
      rows: await listRecentStripePayments({
        secretKey,
        sinceUnix,
        limit: 60
      }),
      error: null
    };
  } catch (error) {
    return {
      rows: [] as ReconciliationStripePayment[],
      error: error instanceof Error ? error.message : "Unable to load Stripe payments."
    };
  }
}

export default async function AdminReconciliationPage({ searchParams }: AdminReconciliationPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const selectedSlug = parseSlug(resolvedSearchParams.slug);

  if (!hasKvEnv()) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 space-y-4">
        <AdminSystemHealthBanner />
        <h1 className="text-lg font-semibold tracking-tight">Reconciliation</h1>
        <AdminCommandPalette />
        <p className="text-sm text-neutral-600">Redis is not configured.</p>
      </main>
    );
  }

  const products = ((await kv.get<Product[]>(key.products)) || []).filter(
    (product): product is Product => Boolean(product?.slug)
  );
  const slugs = products.map((product) => product.slug);
  const sinceUnix = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const [orders, holdSummariesBySlug, stockRows, stripeResult, ledgerEvents] = await Promise.all([
    listRecentOrders(400),
    summarizeReservationHoldsForSlugs(slugs),
    Promise.all(products.map(async (product) => [product.slug, await getStock(product.slug)] as const)),
    loadStripeRows(sinceUnix),
    listInventoryLedgerEvents({
      slug: selectedSlug,
      limit: 80
    })
  ]);

  const stockBySlug = Object.fromEntries(stockRows);
  const productStates: ReconciliationProductState[] = products.map((product) => ({
    slug: product.slug,
    title: product.title,
    stock: product.stock,
    published: product.published,
    archived: product.archived,
    stockKey: stockBySlug[product.slug] || 0,
    holdSummary: holdSummariesBySlug[product.slug] || {
      reservedStock: 0,
      activeCheckoutCount: 0
    }
  }));
  const summary = buildReconciliationSummary({
    orders,
    stripePayments: stripeResult.rows,
    products: productStates,
    lowStockThreshold: getLowStockThreshold()
  });
  const activeHolds = productStates.filter((product) => product.holdSummary.reservedStock > 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Reconciliation</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">
          Compare recent Stripe payments, LAEM orders, inventory holds, and stock movement in one place.
        </p>
      </header>
      <AdminCommandPalette />

      <section className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Missing Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{summary.missingOrderPayments.length}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Stock Conflicts</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{summary.stockConflicts.length}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Held Units</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{summary.activeHeldUnits}</p>
        </div>
        <div className="border border-neutral-200 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Stock Mismatches</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{summary.stockSnapshotMismatches.length}</p>
        </div>
      </section>

      {stripeResult.error ? (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {stripeResult.error}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-800">
              Issues
            </h2>
            <p className="text-sm text-neutral-600">
              Checked {summary.ordersChecked} LAEM orders and {summary.stripePaymentsChecked} recent Stripe payments.
            </p>
          </div>
          <a
            href="/admin/orders?queue=conflicts"
            className="inline-flex h-9 items-center border border-neutral-300 px-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Open Conflicts
          </a>
        </div>
        <div className="grid gap-2">
          {summary.issues.length === 0 ? (
            <div className="border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              No reconciliation issues found in the checked window.
            </div>
          ) : (
            summary.issues.map((issue) => (
              <div key={issue.id} className={`border px-3 py-3 text-sm ${severityClass(issue.severity)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{issue.label}</p>
                  <span className="text-[11px] uppercase tracking-[0.12em]">{issue.severity}</span>
                </div>
                <p className="mt-1">{issue.detail}</p>
                {issue.href ? (
                  <a className="mt-2 inline-flex text-xs font-semibold underline" href={issue.href}>
                    Open
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-800">
            Active Checkout Holds
          </h2>
          <div className="grid gap-2">
            {activeHolds.length === 0 ? (
              <p className="border border-neutral-200 px-3 py-3 text-sm text-neutral-600">
                No active inventory holds right now.
              </p>
            ) : (
              activeHolds.map((product) => (
                <a
                  key={product.slug}
                  href={`/admin/reconciliation?slug=${encodeURIComponent(product.slug)}`}
                  className="border border-neutral-200 px-3 py-3 text-sm text-neutral-800 no-underline hover:bg-neutral-50"
                >
                  <span className="font-semibold">{product.title || product.slug}</span>
                  <span className="ml-2 text-neutral-500">
                    {product.holdSummary.reservedStock} held across {product.holdSummary.activeCheckoutCount} checkout
                    {product.holdSummary.activeCheckoutCount === 1 ? "" : "s"}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-800">
            Low Stock Watch
          </h2>
          <div className="grid gap-2">
            {summary.lowStockProducts.length === 0 ? (
              <p className="border border-neutral-200 px-3 py-3 text-sm text-neutral-600">
                No low-stock live products in the checked catalog.
              </p>
            ) : (
              summary.lowStockProducts.map((product) => (
                <a
                  key={product.slug}
                  href={`/admin/reconciliation?slug=${encodeURIComponent(product.slug)}`}
                  className="border border-neutral-200 px-3 py-3 text-sm text-neutral-800 no-underline hover:bg-neutral-50"
                >
                  <span className="font-semibold">{product.title || product.slug}</span>
                  <span className="ml-2 text-neutral-500">{product.stockKey} in live stock</span>
                </a>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-800">
              Inventory Timeline
            </h2>
            <p className="text-sm text-neutral-600">
              {selectedSlug ? (
                <>
                  Showing stock movement for <code>{selectedSlug}</code>.
                </>
              ) : (
                <>Showing recent global inventory movement.</>
              )}
            </p>
          </div>
          <form className="flex flex-wrap gap-2" action="/admin/reconciliation">
            <input
              name="slug"
              defaultValue={selectedSlug || ""}
              placeholder="Filter by product slug"
              className="h-10 min-w-64 border border-neutral-300 px-3 text-sm"
            />
            <button className="h-10 border border-neutral-900 bg-neutral-900 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white">
              Filter
            </button>
            {selectedSlug ? (
              <a
                href="/admin/reconciliation"
                className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
              >
                Clear
              </a>
            ) : null}
          </form>
        </div>

        <div className="overflow-x-auto border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-[0.12em] text-neutral-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Held</th>
                <th className="px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ledgerEvents.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-neutral-500" colSpan={6}>
                    No inventory timeline events recorded yet. New holds, releases, POS sales, web sales, and admin stock edits will appear here.
                  </td>
                </tr>
              ) : (
                ledgerEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-600">{formatDate(event.createdAt)}</td>
                    <td className="px-3 py-3">
                      <a className="font-semibold text-neutral-900 underline" href={`/admin/reconciliation?slug=${encodeURIComponent(event.slug)}`}>
                        {event.slug}
                      </a>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex border px-2 py-1 text-xs font-semibold ${getEventTone(event)}`}>
                        {describeInventoryLedgerEvent(event)}
                      </span>
                      {event.note ? <p className="mt-1 text-xs text-neutral-500">{event.note}</p> : null}
                    </td>
                    <td className="px-3 py-3 text-neutral-700">
                      {event.stockBefore ?? "-"} → {event.stockAfter ?? "-"}{" "}
                      <span className="text-neutral-500">({formatSigned(event.stockDelta)})</span>
                    </td>
                    <td className="px-3 py-3 text-neutral-700">
                      {event.reservedBefore ?? "-"} → {event.reservedAfter ?? "-"}{" "}
                      <span className="text-neutral-500">({formatSigned(event.reservedDelta)})</span>
                    </td>
                    <td className="px-3 py-3 text-neutral-600">
                      {event.referenceId ? <code>{event.referenceId}</code> : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
