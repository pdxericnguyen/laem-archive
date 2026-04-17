import OrdersClient from "./ui";

export const metadata = { title: "Orders | Admin" };

export default function AdminOrdersPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Orders</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">
          Filter by status/date, resolve stock conflicts, auto-fulfill with label printing, or manually mark paid orders as shipped.
        </p>
      </header>

      <OrdersClient />
    </main>
  );
}
