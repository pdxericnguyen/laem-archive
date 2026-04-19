import { expect, test } from "@playwright/test";

import { redactOrderPii, shouldAutoRedactOrderPii, type OrderRecord } from "../../lib/orders";

function buildShippedOrder(overrides?: Partial<OrderRecord>): OrderRecord {
  return {
    id: "cs_test_order_1",
    slug: "silver-earring-01",
    email: "customer@example.com",
    created: 1_700_000_000,
    quantity: 1,
    status: "shipped",
    amount_total: 12000,
    currency: "usd",
    channel: "checkout",
    stripeObjectType: "checkout_session",
    shippingAddress: {
      name: "Customer Name",
      phone: "5555555555",
      line1: "123 Main St",
      line2: null,
      city: "Portland",
      state: "OR",
      postalCode: "97201",
      country: "US"
    },
    shipping: {
      carrier: "USPS",
      trackingNumber: "9400",
      trackingUrl: "https://tracking.example/9400",
      shippedAt: 1_700_000_000
    },
    ...overrides
  };
}

test("auto redaction triggers for shipped orders older than retention window", () => {
  const nowUnix = Math.floor(Date.now() / 1000);
  const shippedAt = nowUnix - 181 * 24 * 60 * 60;
  const order = buildShippedOrder({
    created: shippedAt,
    shipping: {
      carrier: "USPS",
      trackingNumber: "9400",
      trackingUrl: "https://tracking.example/9400",
      shippedAt
    }
  });
  expect(shouldAutoRedactOrderPii(order, nowUnix)).toBeTruthy();
});

test("auto redaction does not trigger for non-shipped orders", () => {
  const nowUnix = Math.floor(Date.now() / 1000);
  const order = buildShippedOrder({
    status: "paid",
    shipping: undefined
  });
  expect(shouldAutoRedactOrderPii(order, nowUnix)).toBeFalsy();
});

test("retention days can be configured through env", () => {
  const prior = process.env.ORDER_PII_RETENTION_DAYS;
  process.env.ORDER_PII_RETENTION_DAYS = "365";
  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const shippedAt = nowUnix - 181 * 24 * 60 * 60;
    const order = buildShippedOrder({
      created: shippedAt,
      shipping: {
        carrier: "USPS",
        trackingNumber: "9400",
        trackingUrl: "https://tracking.example/9400",
        shippedAt
      }
    });
    expect(shouldAutoRedactOrderPii(order, nowUnix)).toBeFalsy();
  } finally {
    if (prior === undefined) {
      delete process.env.ORDER_PII_RETENTION_DAYS;
    } else {
      process.env.ORDER_PII_RETENTION_DAYS = prior;
    }
  }
});

test("manual redaction removes customer PII", () => {
  const order = buildShippedOrder();
  const redacted = redactOrderPii(order, "manual");
  expect(redacted.email).toBeNull();
  expect(redacted.shippingAddress).toBeUndefined();
  expect(redacted.piiRedactedAt).toBeGreaterThan(0);
  expect(redacted.piiRedactionReason).toBe("manual");
});
