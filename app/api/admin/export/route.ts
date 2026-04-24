import { NextResponse } from "next/server";

import { listAdminAuditEvents, recordAdminAuditEvent } from "@/lib/admin-audit";
import { getAdminSettings } from "@/lib/admin-settings";
import { listInventoryLedgerEvents } from "@/lib/inventory-ledger";
import { hasKvEnv, key, kv } from "@/lib/kv";
import { readOrder, type OrderRecord } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";
import type { Product } from "@/lib/store";

export const runtime = "nodejs";

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function GET(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!hasKvEnv()) {
    return NextResponse.json({ ok: false, error: "Missing KV configuration" }, { status: 500 });
  }

  const products = ((await kv.get<Product[]>(key.products)) || []).filter(Boolean);
  const orderIds = (await kv.lrange<string>(key.ordersIndex, 0, 999)) || [];
  const orders = (await Promise.all(orderIds.map((id) => readOrder(id, { skipPiiRetention: true })))).filter(
    (order): order is OrderRecord => Boolean(order)
  );
  const [inventoryLedger, auditEvents, settings] = await Promise.all([
    listInventoryLedgerEvents({ limit: 200 }),
    listAdminAuditEvents(250),
    getAdminSettings()
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    products,
    orders,
    inventoryLedger,
    auditEvents,
    settings
  };

  await recordAdminAuditEvent({
    action: "export_created",
    entity: "export",
    entityId: "admin-export",
    summary: "Admin JSON export created",
    details: {
      products: products.length,
      orders: orders.length,
      inventoryLedger: inventoryLedger.length,
      auditEvents: auditEvents.length
    }
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="laem-admin-export-${timestampForFileName()}.json"`
    }
  });
}
