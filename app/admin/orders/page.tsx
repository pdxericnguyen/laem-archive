import OrdersClient from "./ui";

export const metadata = { title: "Orders | Admin" };

export default function AdminOrdersPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-neutral-600">
          Filter by status/date, page through results, resolve stock conflicts, and mark paid orders as shipped.
        </p>
      </header>

      <OrdersClient />
    </main>
  );
}
