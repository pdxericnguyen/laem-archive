import AdminCommandPalette from "./command-palette";
import AdminSystemHealthBanner from "./system-health-banner";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { readOrder } from "@/lib/orders";
import { getLowStockThreshold } from "@/lib/inventory";

export const metadata = { title: "Admin | LAEM Archive" };
export const dynamic = "force-dynamic";

async function getDashboardStats() {
  if (!hasKvEnv()) {
    return {
      paidToday: 0,
      unfulfilled: 0,
      lowStock: 0,
      printFailures: 0
    };
  }

  const now = new Date();
  const startOfDayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDayUnix = Math.floor(startOfDayLocal.getTime() / 1000);

  const orderIds = (await kv.lrange<string>(key.ordersIndex, 0, 399)) || [];
  const orders = (await Promise.all(orderIds.map((id) => readOrder(id)))).filter(Boolean);

  const paidToday = orders.filter((order) => order.status === "paid" && order.created >= startOfDayUnix).length;
  const unfulfilled = orders.filter((order) => order.status === "paid").length;
  const printFailures = orders.filter(
    (order) =>
      order.printing?.packingSlip?.status === "failed" || order.printing?.shippingLabel?.status === "failed"
  ).length;

  const products = (await kv.get<Array<{ stock?: number }>>(key.products)) || [];
  const lowStockThreshold = getLowStockThreshold();
  const lowStock = products.filter((product) => Number(product?.stock || 0) > 0 && Number(product?.stock || 0) <= lowStockThreshold).length;

  return {
    paidToday,
    unfulfilled,
    lowStock,
    printFailures
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
