import { NextResponse } from "next/server";

import { readOrder, writeOrder } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

type ResolvePayload = {
  orderId: string;
  note: string;
};

async function getPayload(request: Request): Promise<ResolvePayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!orderId) {
      return null;
    }
    return { orderId, note };
  }

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") || "").trim();
  const note = String(formData.get("note") || "").trim();
  if (!orderId) {
    return null;
  }
  return { orderId, note };
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  if (order.status === "conflict_resolved") {
    return NextResponse.json({ ok: true, already: true });
  }

  if (order.status !== "stock_conflict") {
    return NextResponse.json(
      { ok: false, error: "Only stock conflict orders can be resolved." },
      { status: 409 }
    );
  }

  const updated = {
    ...order,
    status: "conflict_resolved" as const,
    conflictResolution: {
      note: payload.note || "Resolved in admin",
      resolvedAt: Math.floor(Date.now() / 1000)
    }
  };

  await writeOrder(updated);

  return NextResponse.json({ ok: true });
}
