"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type OrderStatus = "paid" | "shipped" | "stock_conflict" | string;

type OrderRow = {
  id: string;
  slug?: string | null;
  email?: string | null;
  created?: number | null;
  quantity?: number;
  amount_total?: number | null;
  currency?: string | null;
  status?: OrderStatus;
  stripe_dashboard_url?: string;
  shipping?: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    shippedAt?: number;
  };
};

type Filters = {
  status: "all" | "paid" | "shipped" | "stock_conflict";
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

function toStatusLabel(status?: OrderStatus) {
  if (status === "shipped") {
    return "Shipped";
  }
  if (status === "stock_conflict") {
    return "Stock Conflict";
  }
  return "Paid";
}

export default function OrdersClient() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<InlineNotice | null>(null);

  const [draftFilters, setDraftFilters] = useState<Filters>({
    status: "all",
    from: "",
    to: ""
  });
  const [filters, setFilters] = useState<Filters>({
    status: "all",
    from: "",
    to: ""
  });
  const [page, setPage] = useState(1);
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

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFilters(draftFilters);
    setPage(1);
  }

  const showingRange = useMemo(() => {
    if (pagination.total === 0) {
      return "0 of 0";
    }
    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = Math.min(pagination.total, pagination.page * pagination.limit);
    return `${start}-${end} of ${pagination.total}`;
  }, [pagination]);

  return (
    <div className="space-y-6">
      <form onSubmit={applyFilters} className="grid gap-2 border border-neutral-200 p-3 md:grid-cols-5">
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
              onShipped={async (message) => {
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
  onShipped
}: {
  row: OrderRow;
  onShipped: (message: string) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  return (
    <div className="border border-neutral-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{row.slug || "-"}</div>
          <div className="text-xs text-neutral-600">
            {row.email || "-"} | {formatDate(row.created)} | qty {row.quantity ?? "-"} |{" "}
            {formatMoney(row.amount_total, row.currency)}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 break-all">Order {row.id}</div>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-neutral-600">{toStatusLabel(row.status)}</div>
      </div>

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

      {row.status === "shipped" && row.shipping ? (
        <div className="text-sm text-neutral-700">
          <div className="text-xs uppercase tracking-[0.12em] text-neutral-600">Shipping</div>
          <div className="mt-1">
            {row.shipping.carrier} |{" "}
            <a
              className="underline"
              href={row.shipping.trackingUrl}
              target="_blank"
              rel="noreferrer"
            >
              {row.shipping.trackingNumber}
            </a>
          </div>
        </div>
      ) : null}

      {row.status === "stock_conflict" ? (
        <p className="text-xs text-red-600">
          Stock conflict detected. Resolve/refund before any fulfillment action.
        </p>
      ) : null}

      {row.status === "paid" ? (
        <form onSubmit={markShipped} className="grid gap-2 md:grid-cols-4">
          <input
            name="carrier"
            placeholder="Carrier"
            className="h-10 border border-neutral-300 px-3 text-sm"
            required
          />
          <input
            name="trackingNumber"
            placeholder="Tracking #"
            className="h-10 border border-neutral-300 px-3 text-sm"
            required
          />
          <input
            name="trackingUrl"
            placeholder="Tracking URL"
            className="h-10 border border-neutral-300 px-3 text-sm md:col-span-2"
            required
          />
          <button
            disabled={sending}
            className="h-10 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 md:col-span-4 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Mark shipped + email"}
          </button>
          {success ? <p className="text-xs text-green-700 md:col-span-4">{success}</p> : null}
          {error ? <p className="text-xs text-red-600 md:col-span-4">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
