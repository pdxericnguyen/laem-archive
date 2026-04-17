import { hasKvEnv } from "@/lib/kv";

export type AdminHealthLevel = "ok" | "warning";

export type AdminHealthCheck = {
  id: string;
  label: string;
  ok: boolean;
  message: string;
};

export type AdminHealthSummary = {
  level: AdminHealthLevel;
  checks: AdminHealthCheck[];
};

function hasEnv(name: string) {
  return Boolean(process.env[name] && process.env[name]?.trim());
}

function hasAnyEnv(names: string[]) {
  return names.some((name) => hasEnv(name));
}

export function getAdminHealthSummary(): AdminHealthSummary {
  const checks: AdminHealthCheck[] = [
    {
      id: "stripe",
      label: "Stripe",
      ok: hasAnyEnv(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
      message: "Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET for checkout/order processing."
    },
    {
      id: "redis",
      label: "Redis",
      ok: hasKvEnv(),
      message: "Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV aliases)."
    },
    {
      id: "blob",
      label: "Blob Uploads",
      ok: hasEnv("BLOB_READ_WRITE_TOKEN"),
      message: "Requires BLOB_READ_WRITE_TOKEN for product/visual image uploads."
    },
    {
      id: "easypost",
      label: "EasyPost",
      ok:
        hasEnv("EASYPOST_API_KEY") &&
        hasEnv("SHIP_FROM_LINE1") &&
        hasEnv("SHIP_FROM_CITY") &&
        hasEnv("SHIP_FROM_STATE") &&
        hasEnv("SHIP_FROM_POSTAL_CODE"),
      message: "Requires EASYPOST_API_KEY and SHIP_FROM_* fields for auto-fulfillment."
    },
    {
      id: "printnode",
      label: "PrintNode",
      ok:
        hasEnv("PRINTNODE_API_KEY") &&
        hasEnv("PRINTNODE_SLIP_PRINTER_ID") &&
        hasEnv("PRINTNODE_LABEL_PRINTER_ID"),
      message: "Requires PRINTNODE_API_KEY and printer IDs for packing slip + label printing."
    }
  ];

  return {
    level: checks.every((check) => check.ok) ? "ok" : "warning",
    checks
  };
}
