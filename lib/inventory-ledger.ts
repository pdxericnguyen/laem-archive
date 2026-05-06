import { key, kv } from "@/lib/kv";

export type InventoryLedgerKind =
  | "reservation_created"
  | "reservation_released"
  | "reservation_expired"
  | "reservation_completed"
  | "stock_sold"
  | "stock_adjusted"
  | "stock_conflict";

export type InventoryLedgerSource = "checkout" | "terminal" | "cash" | "admin" | "system";

export type InventoryLedgerEvent = {
  id: string;
  createdAt: number;
  slug: string;
  kind: InventoryLedgerKind;
  source: InventoryLedgerSource;
  quantity: number;
  referenceId?: string;
  stockBefore?: number;
  stockAfter?: number;
  stockDelta?: number;
  reservedBefore?: number;
  reservedAfter?: number;
  reservedDelta?: number;
  note?: string;
};

export type InventoryLedgerEventInput = Omit<InventoryLedgerEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

const GLOBAL_LEDGER_LIMIT = 500;
const SLUG_LEDGER_LIMIT = 120;
const VALID_KINDS = new Set<InventoryLedgerKind>([
  "reservation_created",
  "reservation_released",
  "reservation_expired",
  "reservation_completed",
  "stock_sold",
  "stock_adjusted",
  "stock_conflict"
]);
const VALID_SOURCES = new Set<InventoryLedgerSource>(["checkout", "terminal", "cash", "admin", "system"]);

function generateLedgerId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

export function normalizeInventoryLedgerEvent(input: InventoryLedgerEventInput): InventoryLedgerEvent | null {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!slug) {
    return null;
  }

  const quantity = normalizeNumber(input.quantity);
  if (quantity === undefined || quantity < 0) {
    return null;
  }
  if (!VALID_KINDS.has(input.kind) || !VALID_SOURCES.has(input.source)) {
    return null;
  }

  const event: InventoryLedgerEvent = {
    id: input.id || generateLedgerId(),
    createdAt: normalizeNumber(input.createdAt) || Math.floor(Date.now() / 1000),
    slug,
    kind: input.kind,
    source: input.source,
    quantity
  };

  if (input.referenceId) {
    event.referenceId = input.referenceId;
  }
  if (input.note) {
    event.note = input.note;
  }

  const optionalNumbers: Array<keyof InventoryLedgerEvent> = [
    "stockBefore",
    "stockAfter",
    "stockDelta",
    "reservedBefore",
    "reservedAfter",
    "reservedDelta"
  ];

  for (const field of optionalNumbers) {
    const value = normalizeNumber(input[field]);
    if (value !== undefined) {
      (event[field] as number | undefined) = value;
    }
  }

  return event;
}

export function parseInventoryLedgerEvent(value: unknown): InventoryLedgerEvent | null {
  if (!value) {
    return null;
  }

  const row = typeof value === "string" ? JSON.parse(value) : value;
  if (!row || typeof row !== "object") {
    return null;
  }

  return normalizeInventoryLedgerEvent(row as InventoryLedgerEventInput);
}

export async function recordInventoryLedgerEvent(input: InventoryLedgerEventInput) {
  const event = normalizeInventoryLedgerEvent(input);
  if (!event) {
    return null;
  }

  const payload = JSON.stringify(event);
  try {
    await Promise.all([
      kv.lpush(key.inventoryLedger, payload),
      kv.lpush(key.inventoryLedgerBySlug(event.slug), payload)
    ]);
    await Promise.all([
      kv.ltrim(key.inventoryLedger, 0, GLOBAL_LEDGER_LIMIT - 1),
      kv.ltrim(key.inventoryLedgerBySlug(event.slug), 0, SLUG_LEDGER_LIMIT - 1)
    ]);
  } catch (error) {
    console.error("Unable to record inventory ledger event", {
      error,
      event
    });
    return null;
  }

  return event;
}

export async function listInventoryLedgerEvents(options?: {
  slug?: string | null;
  limit?: number;
}): Promise<InventoryLedgerEvent[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(options?.limit || 60)));
  const ledgerKey = options?.slug ? key.inventoryLedgerBySlug(options.slug) : key.inventoryLedger;
  const rows = (await kv.lrange<unknown>(ledgerKey, 0, limit - 1)) || [];
  return rows
    .map((row) => {
      try {
        return parseInventoryLedgerEvent(row);
      } catch {
        return null;
      }
    })
    .filter((row): row is InventoryLedgerEvent => Boolean(row))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function describeInventoryLedgerEvent(event: InventoryLedgerEvent) {
  switch (event.kind) {
    case "reservation_created":
      return "Checkout hold created";
    case "reservation_released":
      return "Checkout hold released";
    case "reservation_expired":
      return "Checkout hold expired";
    case "reservation_completed":
      return "Checkout hold completed";
    case "stock_sold":
      return event.source === "terminal" || event.source === "cash" ? "POS sale completed" : "Web sale completed";
    case "stock_adjusted":
      return "Admin stock adjusted";
    case "stock_conflict":
      return "Stock conflict recorded";
    default:
      return "Inventory event";
  }
}
