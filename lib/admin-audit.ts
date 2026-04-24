import { hasKvEnv, key, kv } from "@/lib/kv";

export type AdminAuditEntity = "order" | "product" | "settings" | "export" | "visual" | "auth";

export type AdminAuditAction =
  | "admin_login"
  | "admin_logout"
  | "settings_saved"
  | "export_created"
  | "product_saved"
  | "product_deleted"
  | "stock_bulk_updated"
  | "order_marked_shipped"
  | "order_auto_fulfilled"
  | "order_conflict_resolved"
  | "order_refunded"
  | "order_note_added"
  | "order_address_updated"
  | "order_email_resent"
  | "order_pii_redacted"
  | "order_reprint_requested"
  | "visual_saved"
  | "visual_deleted";

export type AdminAuditEvent = {
  id: string;
  createdAt: number;
  action: AdminAuditAction;
  entity: AdminAuditEntity;
  entityId: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type AdminAuditEventInput = Omit<AdminAuditEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

const ADMIN_AUDIT_LIMIT = 700;

function generateAuditId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asUnix(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : Math.floor(Date.now() / 1000);
}

export function normalizeAdminAuditEvent(input: AdminAuditEventInput): AdminAuditEvent | null {
  const entityId = asString(input.entityId);
  const summary = asString(input.summary);
  if (!entityId || !summary) {
    return null;
  }

  const event: AdminAuditEvent = {
    id: asString(input.id) || generateAuditId(),
    createdAt: asUnix(input.createdAt),
    action: input.action,
    entity: input.entity,
    entityId,
    summary
  };

  if (input.details && typeof input.details === "object") {
    event.details = input.details;
  }

  return event;
}

export async function recordAdminAuditEvent(input: AdminAuditEventInput) {
  const event = normalizeAdminAuditEvent(input);
  if (!event || !hasKvEnv()) {
    return null;
  }

  try {
    await kv.lpush(key.adminAudit, JSON.stringify(event));
    await kv.ltrim(key.adminAudit, 0, ADMIN_AUDIT_LIMIT - 1);
  } catch (error) {
    console.error("Unable to record admin audit event", {
      event,
      error
    });
    return null;
  }

  return event;
}

export function parseAdminAuditEvent(value: unknown): AdminAuditEvent | null {
  if (!value) {
    return null;
  }

  const row = typeof value === "string" ? JSON.parse(value) : value;
  if (!row || typeof row !== "object") {
    return null;
  }

  return normalizeAdminAuditEvent(row as AdminAuditEventInput);
}

export async function listAdminAuditEvents(limit = 100): Promise<AdminAuditEvent[]> {
  if (!hasKvEnv()) {
    return [];
  }

  const safeLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  const rows = (await kv.lrange<unknown>(key.adminAudit, 0, safeLimit - 1)) || [];
  return rows
    .map((row) => {
      try {
        return parseAdminAuditEvent(row);
      } catch {
        return null;
      }
    })
    .filter((row): row is AdminAuditEvent => Boolean(row))
    .sort((a, b) => b.createdAt - a.createdAt);
}
