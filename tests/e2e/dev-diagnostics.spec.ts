import { expect, test } from "@playwright/test";

import {
  describeInventoryLedgerEvent,
  normalizeInventoryLedgerEvent
} from "../../lib/inventory-ledger";
import { getProductInventoryItemId } from "../../lib/inventory";
import { buildDevDiagnosticsSummary } from "../../lib/dev-diagnostics";

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

test("inventory identity requires a stable inventory id", () => {
  expect(
    getProductInventoryItemId(
      {
        inventoryItemId: "original-inventory-id"
      }
    )
  ).toBe("original-inventory-id");

  expect(
    getProductInventoryItemId(
      {
      }
    )
  ).toBeNull();
});

test("dev diagnostics summary flags missing orders and missing inventory identities", () => {
  const summary = buildDevDiagnosticsSummary({
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
        stockKey: 1,
        hasInventoryItemId: false,
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
  expect(summary.missingInventoryIdentities).toHaveLength(1);
  expect(summary.activeHeldUnits).toBe(1);
  expect(summary.issues.map((issue) => issue.severity)).toEqual(["high", "high", "medium", "low"]);
});
