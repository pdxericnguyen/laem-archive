import { getAdminHealthSummary } from "@/lib/admin-health";

export default function AdminSystemHealthBanner() {
  const summary = getAdminHealthSummary();
  const missing = summary.checks.filter((check) => !check.ok);

  if (summary.level === "ok") {
    return (
      <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Admin system health is fully configured.
      </div>
    );
  }

  return (
    <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">Action needed: some admin integrations are not configured.</p>
      <ul className="mt-1 list-disc pl-4">
        {missing.map((check) => (
          <li key={check.id}>
            <span className="font-semibold">{check.label}:</span> {check.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
