import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import {
  buildEasyPostFulfillmentIdempotencyKey,
  createEasyPostShipmentAndBuyLabel
} from "@/lib/easypost";
import { sendShippedEmail } from "@/lib/email";
import { createPrintNodeJob, getPrintNodePrinterId } from "@/lib/printnode";
import {
  acquireOrderFulfillmentLock,
  readOrder,
  releaseOrderFulfillmentLock,
  type OrderPrintJob,
  writeOrder
} from "@/lib/orders";
import { requireAdminOrThrow } from "@/lib/require-admin";
import { defaultTrackingUrl, normalizeHttpUrl } from "@/lib/tracking";

export const runtime = "nodejs";

type FulfillPayload = {
  orderId: string;
  carrier?: string;
  service?: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getPayload(request: Request): Promise<FulfillPayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return null;
    }
    return {
      orderId: asString(body.orderId),
      carrier: asString(body.carrier) || undefined,
      service: asString(body.service) || undefined
    };
  }

  const formData = await request.formData();
  return {
    orderId: asString(formData.get("orderId")),
    carrier: asString(formData.get("carrier")) || undefined,
    service: asString(formData.get("service")) || undefined
  };
}

function toEasyPostAddress(order: Awaited<ReturnType<typeof readOrder>>) {
  const shippingAddress = order?.shippingAddress;
  if (!shippingAddress?.line1) {
    return { ok: false as const, error: "Missing shipping address for this order." };
  }

  const country = asString(shippingAddress.country || "US").toUpperCase();
  const city = asString(shippingAddress.city);
  const postalCode = asString(shippingAddress.postalCode);
  const state = asString(shippingAddress.state);

  if (!city || !postalCode || !country) {
    return { ok: false as const, error: "Shipping address is incomplete (city/postal/country required)." };
  }
  if (country === "US" && !state) {
    return { ok: false as const, error: "US shipping address is missing state." };
  }

  return {
    ok: true as const,
    value: {
      name: asString(shippingAddress.name) || "Customer",
      phone: asString(shippingAddress.phone) || undefined,
      email: asString(order?.email) || undefined,
      street1: shippingAddress.line1,
      street2: asString(shippingAddress.line2) || undefined,
      city,
      state,
      zip: postalCode,
      country
    }
  };
}

async function maybePrintShippingLabel(orderId: string, labelUrl: string): Promise<OrderPrintJob | undefined> {
  const printerId = getPrintNodePrinterId("PRINTNODE_LABEL_PRINTER_ID");
  if (!printerId) {
    return {
      status: "disabled",
      provider: "printnode",
      externalId: null,
      error: "Missing PRINTNODE_LABEL_PRINTER_ID.",
      updatedAt: Math.floor(Date.now() / 1000)
    };
  }

  const lowerLabelUrl = labelUrl.toLowerCase();
  const contentType = lowerLabelUrl.includes("zpl") ? "raw_uri" : "pdf_uri";

  const printResult = await createPrintNodeJob({
    printerId,
    title: `Shipping Label ${orderId}`,
    source: "LAEM Archive Fulfillment",
    contentType,
    content: labelUrl
  });

  if (!printResult.ok) {
    const printError = "error" in printResult ? printResult.error : "PrintNode print failed.";
    return {
      status: "failed",
      provider: "printnode",
      externalId: null,
      error: printError,
      updatedAt: Math.floor(Date.now() / 1000)
    };
  }

  return {
    status: "sent",
    provider: "printnode",
    externalId: printResult.jobId,
    error: null,
    updatedAt: Math.floor(Date.now() / 1000)
  };
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getPayload(request);
  if (!payload?.orderId) {
    return NextResponse.json({ ok: false, error: "Missing order id." }, { status: 400 });
  }

  const lock = await acquireOrderFulfillmentLock(payload.orderId);
  if (!lock.ok) {
    return NextResponse.json(
      { ok: false, error: "Fulfillment is already in progress for this order." },
      { status: 409 }
    );
  }

  try {
    const order = await readOrder(payload.orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    }

    if (order.status === "shipped") {
      return NextResponse.json({ ok: true, already: true, shipping: order.shipping || null });
    }

    if (order.status === "stock_conflict" || order.status === "conflict_resolved") {
      return NextResponse.json(
        { ok: false, error: "Resolve stock conflict before fulfillment." },
        { status: 409 }
      );
    }
    if (order.status !== "paid") {
      return NextResponse.json(
        { ok: false, error: "Only paid orders can be auto-fulfilled." },
        { status: 409 }
      );
    }

    if (order.channel === "terminal") {
      return NextResponse.json(
        { ok: false, error: "Terminal orders are not eligible for EasyPost auto-fulfillment." },
        { status: 409 }
      );
    }

    if (order.fulfillment?.shipmentId || order.shipping?.labelUrl) {
      return NextResponse.json(
        { ok: false, error: "This order already has fulfillment data. Review it before retrying." },
        { status: 409 }
      );
    }

    const toAddress = toEasyPostAddress(order);
    if (!toAddress.ok) {
      return NextResponse.json({ ok: false, error: toAddress.error }, { status: 409 });
    }

    const purchaseResult = await createEasyPostShipmentAndBuyLabel({
      toAddress: toAddress.value,
      reference: order.id,
      carrier: payload.carrier,
      service: payload.service,
      idempotencyKey: buildEasyPostFulfillmentIdempotencyKey(order.id)
    });
    if (!purchaseResult.ok) {
      const purchaseError =
        "error" in purchaseResult ? purchaseResult.error : "EasyPost purchase failed.";
      return NextResponse.json({ ok: false, error: purchaseError }, { status: 502 });
    }

    const trackingUrl =
      normalizeHttpUrl(purchaseResult.trackerPublicUrl || "") ||
      defaultTrackingUrl(purchaseResult.carrier, purchaseResult.trackingCode);
    const shippedAt = Math.floor(Date.now() / 1000);
    const shippingLabelPrint = await maybePrintShippingLabel(order.id, purchaseResult.labelUrl);

    const updatedOrder = {
      ...order,
      status: "shipped" as const,
      shipping: {
        carrier: purchaseResult.carrier,
        trackingNumber: purchaseResult.trackingCode,
        trackingUrl,
        shippedAt,
        labelUrl: purchaseResult.labelUrl,
        labelFormat: purchaseResult.labelUrl.toLowerCase().includes("zpl") ? "zpl" : "pdf"
      },
      fulfillment: {
        provider: "easypost" as const,
        shipmentId: purchaseResult.shipmentId,
        rateId: purchaseResult.rateId,
        service: purchaseResult.service,
        labelUrl: purchaseResult.labelUrl,
        purchasedAt: shippedAt
      },
      printing: shippingLabelPrint
        ? {
            ...(order.printing || {}),
            shippingLabel: shippingLabelPrint
          }
        : order.printing
    };

    await writeOrder(updatedOrder);
    await recordAdminAuditEvent({
      action: "order_auto_fulfilled",
      entity: "order",
      entityId: order.id,
      summary: "Order auto-fulfilled with EasyPost",
      details: {
        carrier: purchaseResult.carrier,
        trackingCode: purchaseResult.trackingCode,
        shipmentId: purchaseResult.shipmentId,
        rateId: purchaseResult.rateId,
        printStatus: shippingLabelPrint?.status || null
      }
    });

    if (order.email) {
      await sendShippedEmail({
        orderId: order.id,
        customerEmail: order.email,
        carrier: purchaseResult.carrier,
        trackingNumber: purchaseResult.trackingCode,
        trackingUrl
      });
    }

    return NextResponse.json({
      ok: true,
      shipping: updatedOrder.shipping,
      fulfillment: updatedOrder.fulfillment,
      print: shippingLabelPrint || null
    });
  } finally {
    try {
      await releaseOrderFulfillmentLock(payload.orderId, lock.token);
    } catch (error) {
      console.error("Failed to release order fulfillment lock", {
        orderId: payload.orderId,
        error
      });
    }
  }
}
