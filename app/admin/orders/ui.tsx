"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type OrderStatus = "paid" | "shipped" | "stock_conflict" | "conflict_resolved" | string;
type QueueFilter = "all" | "paid_unfulfilled" | "address_missing" | "print_failed" | "conflicts";

type OrderRow = {
  id: string;
  channel?: "checkout" | "terminal" | string;
  slug?: string | null;
  items?: Array<{ slug?: string; quantity?: number }>;
  email?: string | null;
  created?: number | null;
  quantity?: number;
  amount_total?: number | null;
  currency?: string | null;
  status?: OrderStatus;
  stripe_dashboard_url?: string;
  shippingAddress?: {
    name?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  shipping?: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    shippedAt?: number;
    labelUrl?: string | null;
    labelFormat?: string | null;
  };
  printing?: {
    packingSlip?: {
      status?: "queued" | "sent" | "failed" | "disabled";
      externalId?: string | null;
      error?: string | null;
      updatedAt?: number;
    };
    shippingLabel?: {
      status?: "queued" | "sent" | "failed" | "disabled";
      externalId?: string | null;
      error?: string | null;
      updatedAt?: number;
    };
  };
  fulfillment?: {
    provider?: "easypost" | string;
    service?: string | null;
    purchasedAt?: number | null;
  };
  conflictResolution?: {
    note?: string;
    resolvedAt?: number;
  };
};

type Filters = {
  status: "all" | "paid" | "shipped" | "stock_conflict" | "conflict_resolved";
  queue: QueueFilter;
  from: string;
  to: string;
};

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type InlineNotice = {
  kind: "success" | "error";
  text: string;
};

type TimelineEvent = {
  id: string;
  label: string;
  at?: number | null;
  detail?: string;
};

const DEFAULT_FILTERS: Filters = {
  status: "all",
  queue: "all",
  from: "",
  to: ""
};

const QUEUE_PRESETS: Array<{ id: QueueFilter; label: string }> = [
  { id: "all", label: "All Orders" },
  { id: "paid_unfulfilled", label: "Paid Awaiting Shipment" },
  { id: "address_missing", label: "Address Missing" },
  { id: "print_failed", label: "Print Failed" },
  { id: "conflicts", label: "Conflicts" }
];

function parseFiltersFromUrl() {
  if (typeof window === "undefined") {
    return {
      filters: DEFAULT_FILTERS,
      page: 1
    };
  }

  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const queue = params.get("queue");
  const page = Number(params.get("page") || "1");
  const from = params.get("from") || "";
  const to = params.get("to") || "";

  return {
    filters: {
      status:
        status === "paid" ||
        status === "shipped" ||
        status === "stock_conflict" ||
        status === "conflict_resolved"
          ? status
          : "all",
      queue:
        queue === "paid_unfulfilled" ||
        queue === "address_missing" ||
        queue === "print_failed" ||
        queue === "conflicts"
          ? queue
          : "all",
      from,
      to
    } as Filters,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  };
}

function formatDate(unix?: number | null) {
  if (!unix) {
    return "-";
  }
  return new Date(unix * 1000).toLocaleString();
}

function formatMoney(amountTotal?: number | null, currency?: string | null) {
  if (typeof amountTotal !== "number") {
    return "-";
  }
  const code = String(currency || "usd").toUpperCase();
  return `${(amountTotal / 100).toFixed(2)} ${code}`;
}

function itemSummary(row: OrderRow) {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items
      .map((item) => {
        const parsed = Number(item.quantity ?? 1);
        const safeQuantity = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
        return `${item.slug || "-"} x${safeQuantity}`;
      })
      .join(", ");
  }
  return row.slug || "-";
}

function toStatusLabel(status?: OrderStatus) {
  if (status === "shipped") {
    return "Shipped";
  }
  if (status === "conflict_resolved") {
    return "Conflict Resolved";
  }
  if (status === "stock_conflict") {
    return "Stock Conflict";
  }
  return "Paid";
}

function formatAddress(row: OrderRow) {
  const address = row.shippingAddress;
  if (!address?.line1) {
    return null;
  }

  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(", ");
  const lines = [
    address.name || null,
    address.line1,
    address.line2 || null,
    locality || null,
    address.country || null,
    address.phone ? `Phone: ${address.phone}` : null
  ].filter(Boolean);

  return lines.join("\n");
}

function toPrintBadge(status?: "queued" | "sent" | "failed" | "disabled") {
  if (!status) {
    return null;
  }
  if (status === "sent") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (status === "failed") {
    return "border-rose-300 bg-rose-50 text-rose-700";
  }
  if (status === "disabled") {
    return "border-neutral-300 bg-neutral-100 text-neutral-700";
  }
  return "border-amber-300 bg-amber-50 text-amber-800";
}

function buildTimeline(row: OrderRow): TimelineEvent[] {
  const timeline: TimelineEvent[] = [
    {
      id: "created",
      label: "Order created",
      at: row.created
    }
  ];

  if (row.shippingAddress?.line1) {
    timeline.push({
      id: "address",
      label: "Shipping address captured",
      at: row.created
    });
  }

  if (row.printing?.packingSlip?.updatedAt) {
    timeline.push({
      id: "packing-slip",
      label: `Packing slip print: ${row.printing.packingSlip.status || "updated"}`,
      at: row.printing.packingSlip.updatedAt,
      detail: row.printing.packingSlip.error || undefined
    });
  }

  if (row.fulfillment?.purchasedAt) {
    timeline.push({
      id: "label-purchased",
      label: "Shipping label purchased",
      at: row.fulfillment.purchasedAt
    });
  }

  if (row.printing?.shippingLabel?.updatedAt) {
    timeline.push({
      id: "label-print",
      label: `Shipping label print: ${row.printing.shippingLabel.status || "updated"}`,
      at: row.printing.shippingLabel.updatedAt,
      detail: row.printing.shippingLabel.error || undefined
    });
  }

  if (row.shipping?.shippedAt) {
    timeline.push({
      id: "shipped",
      label: "Marked shipped",
      at: row.shipping.shippedAt
    });
  }

  if (row.conflictResolution?.resolvedAt) {
    timeline.push({
      id: "conflict-resolved",
      label: "Conflict resolved",
      at: row.conflictResolution.resolvedAt,
      detail: row.conflictResolution.note || undefined
    });
  }

  return timeline.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

export default function OrdersClient() {
  const initial = useMemo(() => parseFiltersFromUrl(), []);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<InlineNotice | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkWorking, setBulkWorking] = useState(false);

  const [draftFilters, setDraftFilters] = useState<Filters>(initial.filters);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1
  });

  async function load(targetPage = page, targetFilters = filters) {
    setLoading(true);
    setError(null);

    try {
      const url = new URL("/api/admin/orders", window.location.origin);
      url.searchParams.set("limit", String(pagination.limit));
      url.searchParams.set("page", String(targetPage));
      url.searchParams.set("status", targetFilters.status);
      if (targetFilters.queue !== "all") {
        url.searchParams.set("queue", targetFilters.queue);
      }
      if (targetFilters.from) {
        url.searchParams.set("from", targetFilters.from);
      }
      if (targetFilters.to) {
        url.searchParams.set("to", targetFilters.to);
      }

      const response = await fetch(url.toString(), { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setRows([]);
        setError(data?.error || "Unable to load orders.");
        return;
      }

      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      const nextPagination = data.pagination || {};
      setRows(nextRows);
      setPagination({
        page: typeof nextPagination.page === "number" ? nextPagination.page : targetPage,
        limit: typeof nextPagination.limit === "number" ? nextPagination.limit : pagination.limit,
        total: typeof nextPagination.total === "number" ? nextPagination.total : nextRows.length,
        totalPages:
          typeof nextPagination.totalPages === "number"
            ? Math.max(1, nextPagination.totalPages)
            : 1
      });
    } catch {
      setRows([]);
      setError("Unable to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(page, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.status !== "all") {
      params.set("status", filters.status);
    }
    if (filters.queue !== "all") {
      params.set("queue", filters.queue);
    }
    if (filters.from) {
      params.set("from", filters.from);
    }
    if (filters.to) {
      params.set("to", filters.to);
    }
    if (page > 1) {
      params.set("page", String(page));
    }
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [filters, page]);

  useEffect(() => {
    const visibleIds = new Set(rows.map((row) => row.id));
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [rows]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFilters(draftFilters);
    setPage(1);
  }

  function toggleSelect(orderId: string, checked: boolean) {
    setSelectedIds((prev) => {
      if (checked) {
        return [...new Set([...prev, orderId])];
      }
      return prev.filter((id) => id !== orderId);
    });
  }

  function setQueuePreset(queue: QueueFilter) {
    const next = {
      ...draftFilters,
      queue
    };
    setDraftFilters(next);
    setFilters(next);
    setPage(1);
  }

  async function runBulkAction(
    label: string,
    runner: (row: OrderRow) => Promise<{ ok: boolean; error?: string }>
  ) {
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
    if (selectedRows.length === 0) {
      setNotice({ kind: "error", text: "Select at least one order first." });
      return;
    }

    setBulkWorking(true);
    setNotice(null);
    let success = 0;
    const failures: string[] = [];

    for (const row of selectedRows) {
      try {
        const result = await runner(row);
        if (result.ok) {
          success += 1;
          continue;
        }
        failures.push(`${row.id}: ${result.error || "failed"}`);
      } catch (actionError) {
        failures.push(`${row.id}: ${actionError instanceof Error ? actionError.message : "failed"}`);
      }
    }

    if (success > 0) {
      setNotice({
        kind: failures.length > 0 ? "error" : "success",
        text: `${label}: ${success} succeeded${failures.length > 0 ? `, ${failures.length} failed` : ""}.`
      });
    } else {
      setNotice({ kind: "error", text: `${label}: no orders succeeded.` });
    }

    if (failures.length > 0) {
      setError(failures.slice(0, 3).join(" | "));
    }

    await load(page, filters);
    setBulkWorking(false);
  }

  async function bulkSyncAddress() {
    await runBulkAction("Bulk sync address", async (row) => {
      const response = await fetch("/api/admin/orders/sync-shipping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: row.id })
      });
      const data = await response.json().catch(() => null);
      return { ok: Boolean(response.ok && data?.ok), error: data?.error };
    });
  }

  async function bulkAutoFulfill() {
    await runBulkAction("Bulk auto-fulfill", async (row) => {
      const response = await fetch("/api/admin/orders/fulfill-auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: row.id })
      });
      const data = await response.json().catch(() => null);
      return { ok: Boolean(response.ok && data?.ok), error: data?.error };
    });
  }

  async function bulkMarkShipped() {
    const carrier = window.prompt("Carrier for selected orders (e.g. USPS, UPS, FedEx):", "USPS");
    if (!carrier) {
      return;
    }

    await runBulkAction("Bulk mark shipped", async (row) => {
      const trackingNumber = window.prompt(`Tracking number for ${row.id}:`);
      if (!trackingNumber) {
        return { ok: false, error: "Skipped (no tracking number)." };
      }
      const response = await fetch("/api/admin/orders/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: row.id,
          carrier,
          trackingNumber,
          trackingUrl: ""
        })
      });
      const data = await response.json().catch(() => null);
      return { ok: Boolean(response.ok && data?.ok), error: data?.error };
    });
  }

  const showingRange = useMemo(() => {
    if (pagination.total === 0) {
      return "0 of 0";
    }
    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = Math.min(pagination.total, pagination.page * pagination.limit);
    return `${start}-${end} of ${pagination.total}`;
  }, [pagination]);

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border border-neutral-200 p-3">
        {QUEUE_PRESETS.map((preset) => {
          const active = filters.queue === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setQueuePreset(preset.id)}
              className={`h-9 border px-3 text-xs font-semibold uppercase tracking-[0.12em] ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={applyFilters} className="grid gap-2 border border-neutral-200 p-3 md:grid-cols-6">
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Status</span>
          <select
            value={draftFilters.status}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                status: event.target.value as Filters["status"]
              }))
            }
            className="h-10 border border-neutral-300 px-2 text-sm"
          >
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="shipped">Shipped</option>
            <option value="stock_conflict">Stock conflict</option>
            <option value="conflict_resolved">Conflict resolved</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">Queue</span>
          <select
            value={draftFilters.queue}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                queue: event.target.value as Filters["queue"]
              }))
            }
            className="h-10 border border-neutral-300 px-2 text-sm"
          >
            {QUEUE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">From</span>
          <input
            type="date"
            value={draftFilters.from}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                from: event.target.value
              }))
            }
            className="h-10 border border-neutral-300 px-2 text-sm"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">To</span>
          <input
            type="date"
            value={draftFilters.to}
            onChange={(event) =>
              setDraftFilters((prev) => ({
                ...prev,
                to: event.target.value
              }))
            }
            className="h-10 border border-neutral-300 px-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 md:self-end"
        >
          Apply Filters
        </button>
        <button
          type="button"
          onClick={() => load(page, filters)}
          className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 md:self-end"
        >
          Refresh
        </button>
      </form>

      <section className="border border-neutral-200 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-neutral-600">
            Selected {selectedIds.length} of {rows.length} on this page
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(allVisibleSelected ? [] : rows.map((row) => row.id))}
              className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50"
              disabled={loading || rows.length === 0}
            >
              {allVisibleSelected ? "Clear Page Selection" : "Select Page"}
            </button>
            <button
              type="button"
              onClick={bulkSyncAddress}
              disabled={bulkWorking || selectedIds.length === 0}
              className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {bulkWorking ? "Working..." : "Bulk Sync Address"}
            </button>
            <button
              type="button"
              onClick={bulkAutoFulfill}
              disabled={bulkWorking || selectedIds.length === 0}
              className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {bulkWorking ? "Working..." : "Bulk Auto-Fulfill"}
            </button>
            <button
              type="button"
              onClick={bulkMarkShipped}
              disabled={bulkWorking || selectedIds.length === 0}
              className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {bulkWorking ? "Working..." : "Bulk Mark Shipped"}
            </button>
          </div>
        </div>
      </section>

      {notice ? (
        <p className={notice.kind === "success" ? "text-xs text-green-700" : "text-xs text-red-600"}>
          {notice.text}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-neutral-600">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No orders found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <OrderCard
              key={row.id}
              row={row}
              selected={selectedIds.includes(row.id)}
              onSelectedChange={(checked) => toggleSelect(row.id, checked)}
              onShipped={async (message) => {
                setNotice({ kind: "success", text: message });
                await load(page, filters);
              }}
              onResolved={async (message) => {
                setNotice({ kind: "success", text: message });
                await load(page, filters);
              }}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border border-neutral-200 p-3">
        <div className="text-xs text-neutral-600">{showingRange}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-neutral-600">
            Page {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  row,
  selected,
  onSelectedChange,
  onShipped,
  onResolved
}: {
  row: OrderRow;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  onShipped: (message: string) => Promise<void>;
  onResolved: (message: string) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [syncingShipping, setSyncingShipping] = useState(false);
  const [autoFulfilling, setAutoFulfilling] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reprinting, setReprinting] = useState<"packingSlip" | "shippingLabel" | null>(null);
  const [resolveNote, setResolveNote] = useState("Refund handled in Stripe");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const shipToAddress = formatAddress(row);
  const requiresShippingAddress = row.channel !== "terminal";
  const canAutoFulfill = row.channel !== "terminal";
  const missingShippingAddress = requiresShippingAddress && !shipToAddress;
  const timeline = buildTimeline(row);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccess(`${label} copied.`);
      setError(null);
    } catch {
      setError(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function markShipped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      orderId: row.id,
      carrier: String(formData.get("carrier") || ""),
      trackingNumber: String(formData.get("trackingNumber") || ""),
      trackingUrl: String(formData.get("trackingUrl") || "")
    };

    try {
      const response = await fetch("/api/admin/orders/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.error || "Ship failed.");
        return;
      }

      const msg = data?.already ? "Order already marked as shipped." : "Order marked shipped.";
      setSuccess(msg);
      await onShipped(msg);
    } catch {
      setError("Ship failed.");
    } finally {
      setSending(false);
    }
  }

  async function markResolved(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResolving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/orders/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: row.id,
          note: resolveNote
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.error || "Resolve failed.");
        return;
      }

      const msg = data?.already ? "Conflict was already resolved." : "Conflict resolved.";
      setSuccess(msg);
      await onResolved(msg);
    } catch {
      setError("Resolve failed.");
    } finally {
      setResolving(false);
    }
  }

  async function syncShippingAddress() {
    setSyncingShipping(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/orders/sync-shipping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: row.id
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.error || "Unable to sync shipping address.");
        return;
      }

      const msg = data?.already
        ? "Shipping address already up to date."
        : "Shipping address synced from Stripe.";
      setSuccess(msg);
      await onShipped(msg);
    } catch {
      setError("Unable to sync shipping address.");
    } finally {
      setSyncingShipping(false);
    }
  }

  async function autoFulfillOrder() {
    setAutoFulfilling(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/orders/fulfill-auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: row.id
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.error || "Auto fulfillment failed.");
        return;
      }

      const msg = data?.already ? "Order was already shipped." : "Label purchased and fulfillment completed.";
      setSuccess(msg);
      await onShipped(msg);
    } catch {
      setError("Auto fulfillment failed.");
    } finally {
      setAutoFulfilling(false);
    }
  }

  async function retryPrint(kind: "packingSlip" | "shippingLabel") {
    setReprinting(kind);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/orders/reprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: row.id,
          kind
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setError(data?.error || "Reprint failed.");
        return;
      }
      const msg = kind === "packingSlip" ? "Packing slip reprint queued." : "Shipping label reprint queued.";
      setSuccess(msg);
      await onShipped(msg);
    } catch {
      setError("Reprint failed.");
    } finally {
      setReprinting(null);
    }
  }

  return (
    <div className="border border-neutral-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectedChange(event.target.checked)}
              aria-label={`Select order ${row.id}`}
            />
            <div className="text-sm font-medium">{itemSummary(row)}</div>
          </div>
          <div className="text-xs text-neutral-600">
            {row.email || "-"} | {formatDate(row.created)} | qty {row.quantity ?? "-"} |{" "}
            {formatMoney(row.amount_total, row.currency)}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 break-all">Order {row.id}</div>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-neutral-600">{toStatusLabel(row.status)}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {row.stripe_dashboard_url ? (
          <a
            className="inline-flex h-8 items-center border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50"
            href={row.stripe_dashboard_url}
            target="_blank"
            rel="noreferrer"
          >
            Open in Stripe
          </a>
        ) : null}
        {shipToAddress ? (
          <button
            type="button"
            className="inline-flex h-8 items-center border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => copyText(shipToAddress, "Address")}
          >
            Copy Address
          </button>
        ) : null}
        {row.shipping?.trackingNumber ? (
          <button
            type="button"
            className="inline-flex h-8 items-center border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => copyText(row.shipping?.trackingNumber || "", "Tracking number")}
          >
            Copy Tracking #
          </button>
        ) : null}
      </div>

      {shipToAddress ? (
        <div className="text-sm text-neutral-700">
          <div className="text-xs uppercase tracking-[0.12em] text-neutral-600">Ship To</div>
          <div className="mt-1 whitespace-pre-line">{shipToAddress}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {row.printing?.packingSlip?.status ? (
          <div
            className={`inline-flex items-center gap-2 border px-2 py-1 text-[11px] ${
              toPrintBadge(row.printing.packingSlip.status) || "border-neutral-200 text-neutral-600"
            }`}
          >
            <span>Packing slip: {row.printing.packingSlip.status}</span>
            {row.printing.packingSlip.status === "failed" || row.printing.packingSlip.status === "disabled" ? (
              <button
                type="button"
                onClick={() => retryPrint("packingSlip")}
                disabled={reprinting === "packingSlip"}
                className="border border-current px-1 text-[10px] font-semibold uppercase tracking-[0.08em] disabled:opacity-50"
              >
                {reprinting === "packingSlip" ? "Retrying..." : "Retry"}
              </button>
            ) : null}
          </div>
        ) : null}
        {row.printing?.shippingLabel?.status ? (
          <div
            className={`inline-flex items-center gap-2 border px-2 py-1 text-[11px] ${
              toPrintBadge(row.printing.shippingLabel.status) || "border-neutral-200 text-neutral-600"
            }`}
          >
            <span>Label: {row.printing.shippingLabel.status}</span>
            {row.printing.shippingLabel.status === "failed" || row.printing.shippingLabel.status === "disabled" ? (
              <button
                type="button"
                onClick={() => retryPrint("shippingLabel")}
                disabled={reprinting === "shippingLabel"}
                className="border border-current px-1 text-[10px] font-semibold uppercase tracking-[0.08em] disabled:opacity-50"
              >
                {reprinting === "shippingLabel" ? "Retrying..." : "Retry"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {row.status === "shipped" && row.shipping ? (
        <div className="text-sm text-neutral-700">
          <div className="text-xs uppercase tracking-[0.12em] text-neutral-600">Shipping</div>
          <div className="mt-1">
            {row.shipping.carrier} |{" "}
            <a className="underline" href={row.shipping.trackingUrl} target="_blank" rel="noreferrer">
              {row.shipping.trackingNumber}
            </a>
            {row.shipping.labelUrl ? (
              <>
                {" "}
                |{" "}
                <a className="underline" href={row.shipping.labelUrl} target="_blank" rel="noreferrer">
                  Open Label
                </a>
              </>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.shipping.labelUrl ? (
              <button
                type="button"
                className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                onClick={() => retryPrint("shippingLabel")}
                disabled={reprinting === "shippingLabel"}
              >
                {reprinting === "shippingLabel" ? "Reprinting..." : "Reprint Label"}
              </button>
            ) : null}
            <button
              type="button"
              className="h-8 border border-neutral-300 px-3 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
              onClick={() => retryPrint("packingSlip")}
              disabled={reprinting === "packingSlip"}
            >
              {reprinting === "packingSlip" ? "Reprinting..." : "Reprint Packing Slip"}
            </button>
          </div>
          {row.fulfillment?.provider ? (
            <div className="mt-1 text-xs text-neutral-600">
              Fulfillment provider: {row.fulfillment.provider}
              {row.fulfillment.service ? ` (${row.fulfillment.service})` : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border border-neutral-200 p-2 text-xs text-neutral-700">
        <p className="uppercase tracking-[0.12em] text-neutral-500">Timeline</p>
        <ul className="mt-1 space-y-1">
          {timeline.map((event) => (
            <li key={event.id}>
              <span className="font-semibold">{event.label}</span>
              {event.at ? ` - ${formatDate(event.at)}` : ""}
              {event.detail ? ` (${event.detail})` : ""}
            </li>
          ))}
        </ul>
      </div>

      {row.status === "stock_conflict" ? (
        <div className="space-y-2">
          <p className="text-xs text-red-600">
            Stock conflict detected. Resolve/refund before any fulfillment action.
          </p>
          <form onSubmit={markResolved} className="grid gap-2">
            <textarea
              value={resolveNote}
              onChange={(event) => setResolveNote(event.target.value)}
              className="min-h-20 border border-neutral-300 p-2 text-sm"
              placeholder="Resolution note (refund, replacement, manual handling)"
            />
            <button
              disabled={resolving}
              className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {resolving ? "Saving..." : "Mark conflict resolved"}
            </button>
          </form>
        </div>
      ) : null}

      {row.status === "conflict_resolved" ? (
        <div className="space-y-1 text-xs text-neutral-700">
          <p>Conflict resolved. Fulfillment is disabled for this order.</p>
          {row.conflictResolution?.note ? <p>Note: {row.conflictResolution.note}</p> : null}
          {row.conflictResolution?.resolvedAt ? (
            <p>Resolved at: {formatDate(row.conflictResolution.resolvedAt)}</p>
          ) : null}
        </div>
      ) : null}

      {row.status === "paid" ? (
        <div className="space-y-2">
          <div className="sticky bottom-2 z-10 rounded border border-neutral-200 bg-white/95 p-2 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-0">
            <div className="grid gap-2 md:grid-cols-2">
              {canAutoFulfill ? (
                <button
                  type="button"
                  disabled={autoFulfilling || missingShippingAddress}
                  onClick={autoFulfillOrder}
                  className="h-10 w-full border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
                >
                  {autoFulfilling ? "Buying label..." : "Auto Fulfill (buy label + print)"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={reprinting === "packingSlip"}
                onClick={() => retryPrint("packingSlip")}
                className="h-10 w-full border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
              >
                {reprinting === "packingSlip" ? "Reprinting..." : "Reprint Packing Slip"}
              </button>
            </div>
          </div>

          {missingShippingAddress ? (
            <div className="border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <p>Missing shipping address for this checkout order.</p>
              <button
                type="button"
                onClick={syncShippingAddress}
                disabled={syncingShipping}
                className="mt-2 h-8 border border-amber-300 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-amber-100 disabled:opacity-50"
              >
                {syncingShipping ? "Syncing..." : "Sync Address from Stripe"}
              </button>
            </div>
          ) : null}

          <form onSubmit={markShipped} className="grid gap-2 md:grid-cols-4">
            <input
              name="carrier"
              placeholder="Carrier"
              className="h-10 border border-neutral-300 px-3 text-sm"
              list={`carrier-options-${row.id}`}
              required
              defaultValue="USPS"
            />
            <datalist id={`carrier-options-${row.id}`}>
              <option value="USPS" />
              <option value="UPS" />
              <option value="FedEx" />
              <option value="DHL" />
            </datalist>
            <input
              name="trackingNumber"
              placeholder="Tracking #"
              className="h-10 border border-neutral-300 px-3 text-sm"
              required
            />
            <input
              name="trackingUrl"
              placeholder="Tracking URL (optional)"
              className="h-10 border border-neutral-300 px-3 text-sm md:col-span-2"
            />
            <button
              disabled={sending || missingShippingAddress}
              className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 md:col-span-4 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Mark shipped + email"}
            </button>
            {success ? <p className="text-xs text-green-700 md:col-span-4">{success}</p> : null}
            {error ? <p className="text-xs text-red-600 md:col-span-4">{error}</p> : null}
          </form>
        </div>
      ) : (
        <>
          {success ? <p className="text-xs text-green-700">{success}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </>
      )}
    </div>
  );
}
