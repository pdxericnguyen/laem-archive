import { NextResponse } from "next/server";

import { redactOrderPiiById } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

type RedactPayload = {
  orderId: string;
};

async function getPayload(request: Request): Promise<RedactPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) {
      return null;
    }
    return { orderId };
  }

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") || "").trim();
  if (!orderId) {
    return null;
  }
  return { orderId };
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

  const result = await redactOrderPiiById(payload.orderId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    already: result.already,
    piiRedactedAt: result.order.piiRedactedAt || null,
    piiRedactionReason: result.order.piiRedactionReason || null
  });
}
