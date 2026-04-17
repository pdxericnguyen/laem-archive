import { key, kv } from "@/lib/kv";

export type OrderStatus = "paid" | "shipped" | "stock_conflict" | "conflict_resolved";
export type OrderStatusFilter = "all" | OrderStatus;
export type OrderQueueFilter =
  | "all"
  | "paid_unfulfilled"
  | "address_missing"
  | "print_failed"
  | "conflicts";
export type OrderChannel = "checkout" | "terminal";
export type StripeObjectType = "checkout_session" | "payment_intent";

export type OrderShipping = {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  shippedAt: number;
  labelUrl?: string | null;
  labelFormat?: string | null;
};

export type OrderPrintJob = {
  status: "queued" | "sent" | "failed" | "disabled";
  provider: "printnode";
  externalId: string | null;
  error: string | null;
  updatedAt: number;
};

export type OrderPrinting = {
  packingSlip?: OrderPrintJob;
  shippingLabel?: OrderPrintJob;
};

export type OrderFulfillment = {
  provider: "easypost";
  shipmentId: string | null;
  rateId: string | null;
  service: string | null;
  labelUrl: string | null;
  purchasedAt: number;
};

export type OrderShippingAddress = {
  name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type OrderConflictResolution = {
  note: string;
  resolvedAt: number;
};

export type OrderLineItem = {
  slug: string;
  quantity: number;
};

export type OrderRecord = {
  id: string;
  slug: string | null;
  email: string | null;
  created: number;
  quantity: number;
  items?: OrderLineItem[];
  status: OrderStatus;
  amount_total: number | null;
  currency: string | null;
  channel?: OrderChannel;
  stripeObjectType?: StripeObjectType;
  shippingAddress?: OrderShippingAddress;
  shipping?: OrderShipping;
  printing?: OrderPrinting;
  fulfillment?: OrderFulfillment;
  conflictResolution?: OrderConflictResolution;
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
  channel?: unknown;
  stripeObjectType?: unknown;
  stripe_object_type?: unknown;
  items?: Array<{ slug?: unknown; quantity?: unknown }> | null;
  shipping?: {
    carrier?: unknown;
    trackingNumber?: unknown;
    trackingUrl?: unknown;
    shippedAt?: unknown;
    labelUrl?: unknown;
    labelFormat?: unknown;
  } | null;
  printing?: {
    packingSlip?: {
      status?: unknown;
      provider?: unknown;
      externalId?: unknown;
      jobId?: unknown;
      error?: unknown;
      updatedAt?: unknown;
    } | null;
    shippingLabel?: {
      status?: unknown;
      provider?: unknown;
      externalId?: unknown;
      jobId?: unknown;
      error?: unknown;
      updatedAt?: unknown;
    } | null;
  } | null;
  fulfillment?: {
    provider?: unknown;
    shipmentId?: unknown;
    rateId?: unknown;
    service?: unknown;
    labelUrl?: unknown;
    purchasedAt?: unknown;
  } | null;
  shippingAddress?: {
    name?: unknown;
    phone?: unknown;
    line1?: unknown;
    line2?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    postal_code?: unknown;
    country?: unknown;
  } | null;
  conflictResolution?: {
    note?: unknown;
    resolvedAt?: unknown;
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
  if (value === "conflict_resolved") {
    return "conflict_resolved";
  }
  return value === "shipped" ? "shipped" : "paid";
}

function normalizeChannel(value: unknown, id: string): OrderChannel {
  if (value === "terminal" || id.startsWith("pi_")) {
    return "terminal";
  }
  return "checkout";
}

function normalizeStripeObjectType(
  value: unknown,
  id: string,
  channel: OrderChannel
): StripeObjectType {
  if (value === "payment_intent" || value === "checkout_session") {
    return value;
  }
  if (channel === "terminal" || id.startsWith("pi_")) {
    return "payment_intent";
  }
  return "checkout_session";
}

function normalizeShipping(value: LooseOrderRecord["shipping"]): OrderShipping | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const carrier = asString(value.carrier);
  const trackingNumber = asString(value.trackingNumber);
  const trackingUrl = asString(value.trackingUrl);
  const shippedAt = asNumber(value.shippedAt);
  const labelUrl = asString(value.labelUrl);
  const labelFormat = asString(value.labelFormat);

  if (!carrier || !trackingNumber || !trackingUrl || shippedAt === null) {
    return undefined;
  }

  const normalized: OrderShipping = {
    carrier,
    trackingNumber,
    trackingUrl,
    shippedAt
  };

  if (labelUrl) {
    normalized.labelUrl = labelUrl;
  }
  if (labelFormat) {
    normalized.labelFormat = labelFormat;
  }

  return normalized;
}

function normalizePrintJob(value: unknown): OrderPrintJob | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const statusRaw = asString(row.status);
  const status =
    statusRaw === "queued" || statusRaw === "sent" || statusRaw === "failed" || statusRaw === "disabled"
      ? statusRaw
      : null;
  const updatedAt = asNumber(row.updatedAt);

  if (!status || updatedAt === null) {
    return undefined;
  }

  return {
    status,
    provider: "printnode",
    externalId: asString(row.externalId) ?? asString(row.jobId),
    error: asString(row.error),
    updatedAt
  };
}

function normalizePrinting(value: LooseOrderRecord["printing"]): OrderPrinting | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const packingSlip = normalizePrintJob(value.packingSlip);
  const shippingLabel = normalizePrintJob(value.shippingLabel);

  if (!packingSlip && !shippingLabel) {
    return undefined;
  }

  return {
    packingSlip,
    shippingLabel
  };
}

function normalizeFulfillment(value: LooseOrderRecord["fulfillment"]): OrderFulfillment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const provider = asString(value.provider);
  if (provider !== "easypost") {
    return undefined;
  }

  const purchasedAt = asNumber(value.purchasedAt);
  if (purchasedAt === null) {
    return undefined;
  }

  return {
    provider: "easypost",
    shipmentId: asString(value.shipmentId),
    rateId: asString(value.rateId),
    service: asString(value.service),
    labelUrl: asString(value.labelUrl),
    purchasedAt
  };
}

function normalizeShippingAddress(
  value: LooseOrderRecord["shippingAddress"]
): OrderShippingAddress | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const line1 = asString(value.line1);
  if (!line1) {
    return undefined;
  }

  return {
    name: asString(value.name),
    phone: asString(value.phone),
    line1,
    line2: asString(value.line2),
    city: asString(value.city),
    state: asString(value.state),
    postalCode: asString(value.postalCode) ?? asString(value.postal_code),
    country: asString(value.country)
  };
}

function normalizeConflictResolution(
  value: LooseOrderRecord["conflictResolution"]
): OrderConflictResolution | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const note = asString(value.note) ?? "Resolved in admin";
  const resolvedAt = asNumber(value.resolvedAt);
  if (resolvedAt === null) {
    return undefined;
  }

  return {
    note,
    resolvedAt
  };
}

function normalizeLineItems(value: LooseOrderRecord["items"]) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      const slug = asString(item.slug);
      const quantity = asNumber(item.quantity);
      if (!slug || quantity === null) {
        return null;
      }
      return {
        slug,
        quantity: Math.max(1, Math.floor(quantity))
      };
    })
    .filter((row): row is OrderLineItem => Boolean(row));

  return items.length > 0 ? items : undefined;
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
  const channel = normalizeChannel(raw.channel, id);
  const stripeObjectType = normalizeStripeObjectType(
    raw.stripeObjectType ?? raw.stripe_object_type,
    id,
    channel
  );

  return {
    id,
    slug,
    email,
    created,
    quantity,
    items: normalizeLineItems(raw.items),
    status,
    amount_total,
    currency,
    channel,
    stripeObjectType,
    shippingAddress: normalizeShippingAddress(raw.shippingAddress),
    shipping: normalizeShipping(raw.shipping),
    printing: normalizePrinting(raw.printing),
    fulfillment: normalizeFulfillment(raw.fulfillment),
    conflictResolution: normalizeConflictResolution(raw.conflictResolution)
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
  queue?: OrderQueueFilter;
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
  queue: OrderQueueFilter,
  fromUnix: number | null,
  toUnix: number | null
) {
  if (status !== "all" && row.status !== status) {
    return false;
  }
  if (queue === "paid_unfulfilled" && row.status !== "paid") {
    return false;
  }
  if (queue === "address_missing") {
    if (row.status !== "paid") {
      return false;
    }
    if (row.channel === "terminal") {
      return false;
    }
    if (row.shippingAddress?.line1) {
      return false;
    }
  }
  if (queue === "print_failed") {
    const failed =
      row.printing?.packingSlip?.status === "failed" || row.printing?.shippingLabel?.status === "failed";
    if (!failed) {
      return false;
    }
  }
  if (queue === "conflicts" && row.status !== "stock_conflict" && row.status !== "conflict_resolved") {
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
  const queue = options.queue || "all";
  const fromUnix = typeof options.fromUnix === "number" ? options.fromUnix : null;
  const toUnix = typeof options.toUnix === "number" ? options.toUnix : null;

  const ids = (await kv.lrange<string>(key.ordersIndex, 0, 999)) || [];
  const rows = await Promise.all(ids.map((id) => readOrder(id)));
  const filtered = rows
    .filter((row): row is OrderRecord => Boolean(row))
    .filter((row) => matchesFilters(row, status, queue, fromUnix, toUnix))
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
