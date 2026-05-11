export function orderReceivedText() {
  return [
    "Your order has been received.",
    "",
    "The piece will now be prepared and finished for shipment.",
    "Processing time is typically a few days.",
    "",
    "You will receive a separate message once the order has shipped.",
    "",
    "Thank you for your patience.",
    "- LAEM Archive"
  ].join("\n");
}

export function shippedText(args: {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
}) {
  const { carrier, trackingNumber, trackingUrl } = args;

  return [
    "Your order has shipped.",
    "",
    `Carrier: ${carrier}`,
    `Tracking: ${trackingNumber}`,
    "",
    "You can follow the shipment here:",
    trackingUrl,
    "",
    "Thank you for your patience.",
    "- LAEM Archive"
  ].join("\n");
}

type CashReceiptItem = {
  title: string;
  quantity: number;
};

type CashReceiptTemplateArgs = {
  orderId: string;
  amountTotal: number | null;
  currency: string | null;
  items?: CashReceiptItem[];
};

function formatCurrency(amountTotal: number | null, currencyCode: string | null) {
  if (typeof amountTotal !== "number") {
    return null;
  }
  const currency = (currencyCode || "usd").toUpperCase();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amountTotal / 100);
}

function normalizeCashReceiptItems(items: CashReceiptTemplateArgs["items"]) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          if (!item || typeof item.title !== "string") {
            return null;
          }
          const title = item.title.trim();
          if (!title) {
            return null;
          }
          const quantity = Number.isFinite(item.quantity) ? Math.max(1, Math.floor(item.quantity)) : 1;
          return { title, quantity };
        })
        .filter((item): item is CashReceiptItem => Boolean(item))
    : [];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function cashReceiptText(args: {
  orderId: string;
  amountTotal: number | null;
  currency: string | null;
  items?: Array<{
    title: string;
    quantity: number;
  }>;
}) {
  const total = formatCurrency(args.amountTotal, args.currency);
  const normalizedItems = normalizeCashReceiptItems(args.items);
  const showOrderReference = process.env.NODE_ENV !== "production";
  const issuedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());

  const lines = [
    "LAEM Archive Cash Receipt",
    "",
    `Date: ${issuedAt}`,
    "Payment: Cash"
  ];

  if (showOrderReference) {
    lines.push(`Reference: ${args.orderId}`);
  }

  if (total) {
    lines.push(`Total: ${total}`);
  }

  if (normalizedItems.length > 0) {
    lines.push("", "Items:");
    for (const item of normalizedItems) {
      lines.push(`- ${item.title} x${item.quantity}`);
    }
  }

  lines.push("", "Your cash payment has been received.", "", "Thank you for shopping LAEM Archive.");
  return lines.join("\n");
}

export function cashReceiptHtml(args: CashReceiptTemplateArgs) {
  const total = formatCurrency(args.amountTotal, args.currency);
  const normalizedItems = normalizeCashReceiptItems(args.items);
  const showOrderReference = process.env.NODE_ENV !== "production";
  const issuedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
  const itemRows =
    normalizedItems.length > 0
      ? normalizedItems
          .map(
            (item) =>
              `<tr><td style="padding:8px 0;color:#111111;font-size:14px;">${escapeHtml(item.title)}</td><td style="padding:8px 0;color:#111111;font-size:14px;text-align:right;">x${item.quantity}</td></tr>`
          )
          .join("")
      : '<tr><td colspan="2" style="padding:8px 0;color:#666666;font-size:14px;">No line items available.</td></tr>';
  const referenceRow = showOrderReference
    ? `<tr><td style="padding:4px 0;color:#666666;font-size:13px;">Reference</td><td style="padding:4px 0;color:#111111;font-size:13px;text-align:right;">${escapeHtml(args.orderId)}</td></tr>`
    : "";
  const totalRow = total
    ? `<tr><td style="padding:4px 0;color:#666666;font-size:13px;">Total</td><td style="padding:4px 0;color:#111111;font-size:13px;text-align:right;font-weight:600;">${escapeHtml(total)}</td></tr>`
    : "";

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;padding:24px;">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dddddd;padding:24px;">',
    '<p style="margin:0 0 4px 0;font-size:22px;letter-spacing:0.4px;color:#111111;font-weight:600;">LAEM Archive</p>',
    '<p style="margin:0 0 20px 0;font-size:13px;color:#666666;">Cash Receipt</p>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:20px;">',
    `<tr><td style="padding:4px 0;color:#666666;font-size:13px;">Date</td><td style="padding:4px 0;color:#111111;font-size:13px;text-align:right;">${escapeHtml(issuedAt)}</td></tr>`,
    '<tr><td style="padding:4px 0;color:#666666;font-size:13px;">Payment</td><td style="padding:4px 0;color:#111111;font-size:13px;text-align:right;">Cash</td></tr>',
    referenceRow,
    totalRow,
    "</table>",
    '<p style="margin:0 0 10px 0;font-size:13px;color:#666666;">Items</p>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #eeeeee;border-bottom:1px solid #eeeeee;margin-bottom:20px;">',
    itemRows,
    "</table>",
    '<p style="margin:0 0 8px 0;font-size:14px;color:#111111;">Your cash payment has been received.</p>',
    '<p style="margin:0;font-size:14px;color:#111111;">Thank you for shopping LAEM Archive.</p>',
    "</div>",
    "</div>"
  ].join("");
}

export function inventoryAlertText(args: {
  kind: "low" | "zero" | "oversell";
  slug: string;
  currentStock: number;
  previousStock: number;
  orderId?: string;
  quantity?: number;
}) {
  const lines = [
    "Inventory alert.",
    "",
    `Product slug: ${args.slug}`,
    `Transition: ${args.kind}`,
    `Previous stock: ${args.previousStock}`,
    `Current stock: ${args.currentStock}`
  ];

  if (typeof args.quantity === "number") {
    lines.push(`Requested quantity: ${args.quantity}`);
  }
  if (args.orderId) {
    lines.push(`Order/session: ${args.orderId}`);
  }

  lines.push("", "Check admin inventory and Stripe orders.", "- LAEM Archive");
  return lines.join("\n");
}
