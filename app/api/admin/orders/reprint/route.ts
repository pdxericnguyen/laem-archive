import { NextResponse } from "next/server";

import { buildPackingSlipPdfBase64 } from "@/lib/packing-slip-pdf";
import { createPrintNodeJob, getPrintNodePrinterId } from "@/lib/printnode";
import { readOrder, writeOrder } from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

type ReprintPayload = {
  orderId: string;
  kind: "packingSlip" | "shippingLabel";
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getPayload(request: Request): Promise<ReprintPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return null;
    }
    const orderId = asString(body.orderId);
    const kind = asString(body.kind);
    if (!orderId || (kind !== "packingSlip" && kind !== "shippingLabel")) {
      return null;
    }
    return {
      orderId,
      kind
    } as ReprintPayload;
  }

  const formData = await request.formData();
  const orderId = asString(formData.get("orderId"));
  const kind = asString(formData.get("kind"));
  if (!orderId || (kind !== "packingSlip" && kind !== "shippingLabel")) {
    return null;
  }
  return {
    orderId,
    kind
  } as ReprintPayload;
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  }

  const order = await readOrder(payload.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  const printStatusKey = payload.kind;

  if (payload.kind === "shippingLabel") {
    const labelUrl = order.shipping?.labelUrl || "";
    if (!labelUrl) {
      return NextResponse.json(
        { ok: false, error: "No shipping label URL is stored for this order." },
        { status: 409 }
      );
    }

    const printerId = getPrintNodePrinterId("PRINTNODE_LABEL_PRINTER_ID");
    if (!printerId) {
      const updated = {
        ...order,
        printing: {
          ...(order.printing || {}),
          shippingLabel: {
            status: "disabled" as const,
            provider: "printnode" as const,
            externalId: null,
            error: "Missing PRINTNODE_LABEL_PRINTER_ID.",
            updatedAt: now
          }
        }
      };
      await writeOrder(updated);
      return NextResponse.json({ ok: false, error: "Missing PRINTNODE_LABEL_PRINTER_ID." }, { status: 409 });
    }

    const lower = labelUrl.toLowerCase();
    const printResult = await createPrintNodeJob({
      printerId,
      title: `Shipping Label ${order.id}`,
      source: "LAEM Archive Fulfillment",
      contentType: lower.includes("zpl") ? "raw_uri" : "pdf_uri",
      content: labelUrl
    });

    const updated = {
      ...order,
      printing: {
        ...(order.printing || {}),
        shippingLabel: printResult.ok
          ? {
              status: "sent" as const,
              provider: "printnode" as const,
              externalId: printResult.jobId,
              error: null,
              updatedAt: now
            }
          : {
              status: "failed" as const,
              provider: "printnode" as const,
              externalId: null,
              error: "error" in printResult ? printResult.error : "Print failed.",
              updatedAt: now
            }
      }
    };
    await writeOrder(updated);

    if (!printResult.ok) {
      return NextResponse.json(
        { ok: false, error: "error" in printResult ? printResult.error : "Print failed." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      kind: printStatusKey,
      print: updated.printing?.shippingLabel || null
    });
  }

  const printerId = getPrintNodePrinterId("PRINTNODE_SLIP_PRINTER_ID");
  if (!printerId) {
    const updated = {
      ...order,
      printing: {
        ...(order.printing || {}),
        packingSlip: {
          status: "disabled" as const,
          provider: "printnode" as const,
          externalId: null,
          error: "Missing PRINTNODE_SLIP_PRINTER_ID.",
          updatedAt: now
        }
      }
    };
    await writeOrder(updated);
    return NextResponse.json({ ok: false, error: "Missing PRINTNODE_SLIP_PRINTER_ID." }, { status: 409 });
  }

  const printResult = await createPrintNodeJob({
    printerId,
    title: `Packing Slip ${order.id}`,
    source: "LAEM Archive Fulfillment",
    contentType: "pdf_base64",
    content: buildPackingSlipPdfBase64(order)
  });

  const updated = {
    ...order,
    printing: {
      ...(order.printing || {}),
      packingSlip: printResult.ok
        ? {
            status: "sent" as const,
            provider: "printnode" as const,
            externalId: printResult.jobId,
            error: null,
            updatedAt: now
          }
        : {
            status: "failed" as const,
            provider: "printnode" as const,
            externalId: null,
            error: "error" in printResult ? printResult.error : "Print failed.",
            updatedAt: now
          }
    }
  };

  await writeOrder(updated);

  if (!printResult.ok) {
    return NextResponse.json(
      { ok: false, error: "error" in printResult ? printResult.error : "Print failed." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    kind: printStatusKey,
    print: updated.printing?.packingSlip || null
  });
}
