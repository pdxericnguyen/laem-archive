import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import OrdersClient from "./ui";

export const metadata = { title: "Orders | Admin" };

export default function AdminOrdersPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">LAEM Archive</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Order Desk</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">
          Fulfillment operations for LAEM orders, from queue triage to shipment and post-order support.
        </p>
      </header>
      <AdminCommandPalette />

      <OrdersClient />
    </main>
  );
}
