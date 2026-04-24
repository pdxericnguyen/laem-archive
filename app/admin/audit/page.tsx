import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import { listAdminAuditEvents } from "@/lib/admin-audit";
import { hasKvEnv } from "@/lib/kv";

export const metadata = { title: "Audit Log | Admin" };
export const dynamic = "force-dynamic";

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString();
}

function formatAction(action: string) {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function AdminAuditPage() {
  const events = await listAdminAuditEvents(120);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Audit Log</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">
          Recent admin actions across products, orders, settings, exports, and visuals.
        </p>
      </header>
      <AdminCommandPalette />

      {!hasKvEnv() ? <p className="text-sm text-red-600">Redis is not configured.</p> : null}

      {events.length === 0 ? (
        <p className="text-sm text-neutral-600">No audit events found.</p>
      ) : (
        <div className="overflow-x-auto border border-neutral-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-[0.12em] text-neutral-500">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Action</th>
                <th className="p-3">Target</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-neutral-200 align-top">
                  <td className="p-3 text-xs text-neutral-600">{formatDate(event.createdAt)}</td>
                  <td className="p-3 font-semibold">{formatAction(event.action)}</td>
                  <td className="p-3">
                    <div className="text-xs uppercase tracking-[0.12em] text-neutral-500">{event.entity}</div>
                    <div className="mt-1 break-all font-mono text-xs">{event.entityId}</div>
                  </td>
                  <td className="p-3">
                    <div>{event.summary}</div>
                    {event.details ? (
                      <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap bg-neutral-50 p-2 text-[11px] text-neutral-600">
                        {JSON.stringify(event.details, null, 2)}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
