import { key, kv } from "@/lib/kv";

export type OrderStatus = "paid" | "shipped" | "stock_conflict";
export type OrderStatusFilter = "all" | OrderStatus;

export type OrderShipping = {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  shippedAt: number;
};

export type OrderRecord = {
  id: string;
  slug: string | null;
  email: string | null;
  created: number;
  quantity: number;
  status: OrderStatus;
  amount_total: number | null;
  currency: string | null;
  shipping?: OrderShipping;
};

type LooseOrderRecord = {
  id?: unknown;
  slug?: unknown;
  email?: unknown;
  customerEmail?: unknown;
  created?: unknown;
  createdAt?: unknown;
  quantity?: unknown;
  status?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  amountTotal?: unknown;
  currency?: unknown;
  shipping?: {
    carrier?: unknown;
    trackingNumber?: unknown;
    trackingUrl?: unknown;
    shippedAt?: unknown;
  } | null;
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStatus(value: unknown): OrderStatus {
  if (value === "stock_conflict") {
    return "stock_conflict";
  }
  return value === "shipped" ? "shipped" : "paid";
}

function normalizeShipping(value: LooseOrderRecord["shipping"]): OrderShipping | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const carrier = asString(value.carrier);
  const trackingNumber = asString(value.trackingNumber);
  const trackingUrl = asString(value.trackingUrl);
  const shippedAt = asNumber(value.shippedAt);

  if (!carrier || !trackingNumber || !trackingUrl || shippedAt === null) {
    return undefined;
  }

  return {
    carrier,
    trackingNumber,
    trackingUrl,
    shippedAt
  };
}

export function normalizeOrder(input: unknown): OrderRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as LooseOrderRecord;
  const id = asString(raw.id);
  if (!id) {
    return null;
  }

  const slug = asString(raw.slug);
  const email = asString(raw.email) ?? asString(raw.customerEmail);
  const created = asNumber(raw.created) ?? asNumber(raw.createdAt) ?? Math.floor(Date.now() / 1000);
  const quantity = Math.max(1, Math.floor(asNumber(raw.quantity) ?? 1));
  const status = normalizeStatus(raw.status ?? raw.payment_status);
  const amount_total = asNumber(raw.amount_total) ?? asNumber(raw.amountTotal);
  const currency = asString(raw.currency);

  return {
    id,
    slug,
    email,
    created,
    quantity,
    status,
    amount_total,
    currency,
    shipping: normalizeShipping(raw.shipping)
  };
}

export async function readOrder(id: string) {
  const row = await kv.get<unknown>(key.order(id));
  return normalizeOrder(row);
}

export async function writeOrder(order: OrderRecord) {
  await kv.set(key.order(order.id), order);
}

export async function hasOrder(id: string) {
  const order = await readOrder(id);
  return Boolean(order);
}

export async function appendOrderToIndex(id: string) {
  await kv.lpush(key.ordersIndex, id);
}

export async function listRecentOrders(limit: number) {
  const ids = (await kv.lrange<string>(key.ordersIndex, 0, Math.max(0, limit - 1))) || [];
  const rows = await Promise.all(ids.map((id) => readOrder(id)));
  return rows.filter((row): row is OrderRecord => Boolean(row));
}

export type ListOrdersOptions = {
  limit: number;
  page: number;
  status?: OrderStatusFilter;
  fromUnix?: number | null;
  toUnix?: number | null;
};

export type ListOrdersResult = {
  rows: OrderRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function matchesFilters(
  row: OrderRecord,
  status: OrderStatusFilter,
  fromUnix: number | null,
  toUnix: number | null
) {
  if (status !== "all" && row.status !== status) {
    return false;
  }
  if (typeof fromUnix === "number" && row.created < fromUnix) {
    return false;
  }
  if (typeof toUnix === "number" && row.created > toUnix) {
    return false;
  }
  return true;
}

export async function listOrdersPage(options: ListOrdersOptions): Promise<ListOrdersResult> {
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit)));
  const requestedPage = Math.max(1, Math.floor(options.page));
  const status = options.status || "all";
  const fromUnix = typeof options.fromUnix === "number" ? options.fromUnix : null;
  const toUnix = typeof options.toUnix === "number" ? options.toUnix : null;

  const ids = (await kv.lrange<string>(key.ordersIndex, 0, 999)) || [];
  const rows = await Promise.all(ids.map((id) => readOrder(id)));
  const filtered = rows
    .filter((row): row is OrderRecord => Boolean(row))
    .filter((row) => matchesFilters(row, status, fromUnix, toUnix))
    .sort((a, b) => b.created - a.created);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    rows: filtered.slice(start, end),
    total,
    page,
    limit,
    totalPages
  };
}
