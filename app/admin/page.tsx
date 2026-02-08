export const metadata = { title: "Admin | LAEM Archive" };

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
        <form action="/api/admin/auth/logout" method="POST">
          <button className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50">
            Sign out
          </button>
        </form>
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
      </div>
    </main>
  );
}
