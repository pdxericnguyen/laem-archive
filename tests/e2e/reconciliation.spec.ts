import { expect, test } from "@playwright/test";

import {
  describeInventoryLedgerEvent,
  normalizeInventoryLedgerEvent
} from "../../lib/inventory-ledger";
import { buildReconciliationSummary } from "../../lib/reconciliation";

test("inventory ledger events normalize into operator-readable rows", () => {
  const event = normalizeInventoryLedgerEvent({
    id: "evt-test",
    createdAt: 1700000000,
    slug: "silverearring-01",
    kind: "stock_sold",
    source: "checkout",
    referenceId: "cs_test_123",
    quantity: 1,
    stockBefore: 2,
    stockAfter: 1,
    stockDelta: -1
  });

  expect(event).toEqual({
    id: "evt-test",
    createdAt: 1700000000,
    slug: "silverearring-01",
    kind: "stock_sold",
    source: "checkout",
    referenceId: "cs_test_123",
    quantity: 1,
    stockBefore: 2,
    stockAfter: 1,
    stockDelta: -1
  });
  expect(describeInventoryLedgerEvent(event!)).toBe("Web sale completed");
});

test("reconciliation summary flags missing orders and stock mismatches", () => {
  const summary = buildReconciliationSummary({
    orders: [
      {
        id: "cs_known",
        slug: "ring-01",
        email: "buyer@example.com",
        created: 1700000000,
        quantity: 1,
        items: [{ slug: "ring-01", quantity: 1 }],
        status: "stock_conflict",
        amount_total: 10000,
        currency: "usd",
        channel: "checkout",
        stripeObjectType: "checkout_session"
      }
    ],
    stripePayments: [
      {
        id: "cs_missing",
        channel: "checkout",
        created: 1700000100,
        amountTotal: 12000,
        currency: "usd",
        dashboardUrl: "https://dashboard.stripe.com/checkout/sessions/cs_missing"
      }
    ],
    products: [
      {
        slug: "ring-01",
        title: "Ring 01",
        stock: 2,
        stockKey: 1,
        published: true,
        archived: false,
        holdSummary: {
          reservedStock: 1,
          activeCheckoutCount: 1
        }
      }
    ],
    lowStockThreshold: 2
  });

  expect(summary.missingOrderPayments).toHaveLength(1);
  expect(summary.stockConflicts).toHaveLength(1);
  expect(summary.stockSnapshotMismatches).toHaveLength(1);
  expect(summary.activeHeldUnits).toBe(1);
  expect(summary.issues.map((issue) => issue.severity)).toEqual(["high", "high", "medium", "low"]);
});
