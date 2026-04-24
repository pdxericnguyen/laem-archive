import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { readOrder, writeOrder, type OrderNote } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

type NotesPayload = {
  orderId: string;
  note: string;
  kind: "internal" | "follow_up";
};

function normalizeKind(value: unknown): NotesPayload["kind"] {
  return value === "follow_up" ? "follow_up" : "internal";
}

async function getPayload(request: Request): Promise<NotesPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1200) : "";
    if (!orderId || !note) {
      return null;
    }
    return {
      orderId,
      note,
      kind: normalizeKind(body.kind)
    };
  }

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") || "").trim();
  const note = String(formData.get("note") || "").trim().slice(0, 1200);
  if (!orderId || !note) {
    return null;
  }
  return {
    orderId,
    note,
    kind: normalizeKind(formData.get("kind"))
  };
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Order and note are required." }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const note: OrderNote = {
    id: randomUUID(),
    note: payload.note,
    kind: payload.kind,
    createdAt: Math.floor(Date.now() / 1000)
  };

  const updated = {
    ...order,
    notes: [note, ...(order.notes || [])].slice(0, 50)
  };

  await writeOrder(updated);
  await recordAdminAuditEvent({
    action: "order_note_added",
    entity: "order",
    entityId: order.id,
    summary: "Order note added",
    details: {
      kind: note.kind,
      note: note.note
    }
  });

  return NextResponse.json({
    ok: true,
    note
  });
}
