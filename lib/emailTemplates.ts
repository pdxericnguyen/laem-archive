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
