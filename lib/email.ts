import { Resend } from "resend";
import { inventoryAlertText, orderReceivedText, shippedText } from "@/lib/emailTemplates";

function getResend() {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }
  return new Resend(resendApiKey);
}

function getEmailFrom() {
  const emailFrom = process.env.EMAIL_FROM || process.env.RESEND_FROM;
  if (!emailFrom) {
    throw new Error("Missing EMAIL_FROM or RESEND_FROM");
  }
  return emailFrom;
}

export type OrderEmailPayload = {
  orderId: string;
  customerEmail: string;
  productTitle: string | null;
  quantity: number;
};

export type ShippingEmailPayload = {
  orderId: string;
  customerEmail: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
};

export type InventoryAlertPayload = {
  kind: "low" | "zero" | "oversell";
  slug: string;
  currentStock: number;
  previousStock: number;
  orderId?: string;
  quantity?: number;
};

export async function sendOrderReceivedEmail(payload: OrderEmailPayload) {
  const resend = getResend();
  await resend.emails.send({
    from: getEmailFrom(),
    to: payload.customerEmail,
    subject: "Order received",
    text: orderReceivedText()
  });
}

export async function sendShippedEmail(payload: ShippingEmailPayload) {
  const resend = getResend();
  await resend.emails.send({
    from: getEmailFrom(),
    to: payload.customerEmail,
    subject: "Your order has shipped",
    text: shippedText({
      carrier: payload.carrier,
      trackingNumber: payload.trackingNumber,
      trackingUrl: payload.trackingUrl
    })
  });
}

function getInventoryAlertTo() {
  return process.env.INVENTORY_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || null;
}

export async function sendInventoryAlertEmail(payload: InventoryAlertPayload) {
  const to = getInventoryAlertTo();
  if (!to) {
    return { sent: false };
  }

  const resend = getResend();
  await resend.emails.send({
    from: getEmailFrom(),
    to,
    subject: `[Inventory] ${payload.kind.toUpperCase()} ${payload.slug}`,
    text: inventoryAlertText(payload)
  });
  return { sent: true };
}
