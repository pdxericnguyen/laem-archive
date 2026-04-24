import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import { getAdminSettings } from "@/lib/admin-settings";
import { hasKvEnv } from "@/lib/kv";

export const metadata = { title: "System Settings | Admin" };
export const dynamic = "force-dynamic";

type AdminSettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const settings = await getAdminSettings();
  const saved = getParam(resolvedSearchParams, "saved") === "1";
  const error = getParam(resolvedSearchParams, "error");

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">System Settings</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">
          Manage checkout defaults, refund behavior, and data export from the admin system.
        </p>
      </header>
      <AdminCommandPalette />

      {!hasKvEnv() ? <p className="text-sm text-red-600">Redis is not configured.</p> : null}
      {saved ? <p className="text-sm text-green-700">Settings saved.</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="border border-neutral-200 p-4">
        <form action="/api/admin/settings/save" method="POST" className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">
              Shipping Countries
            </span>
            <input
              name="shippingAllowedCountries"
              defaultValue={settings.checkout.shippingAllowedCountries.join(", ")}
              className="h-10 border border-neutral-300 px-3 text-sm"
              placeholder="US, CA"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">
              Stripe Shipping Rate
            </span>
            <input
              name="shippingRateId"
              defaultValue={settings.checkout.shippingRateId || ""}
              className="h-10 border border-neutral-300 px-3 text-sm"
              placeholder="shr_..."
            />
          </label>

          <div className="grid gap-2 text-sm text-neutral-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="automaticTaxEnabled"
                defaultChecked={settings.checkout.automaticTaxEnabled}
              />
              <span>Enable Stripe automatic tax in checkout</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="refundRestockDefault"
                defaultChecked={settings.checkout.refundRestockDefault}
              />
              <span>Default refunds to restock items</span>
            </label>
          </div>

          <button className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50">
            Save Settings
          </button>
        </form>
      </section>

      <section className="border border-neutral-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Export</h2>
            <p className="mt-1 text-xs text-neutral-600">Products, orders, inventory ledger, audit log, and settings.</p>
          </div>
          <a
            href="/api/admin/export"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Download JSON
          </a>
        </div>
      </section>
    </main>
  );
}
