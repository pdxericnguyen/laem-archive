import { expect, test } from "@playwright/test";

import { normalizeCountryCodes, validateAdminSettingsInput } from "../../lib/admin-settings";
import { buildEasyPostFulfillmentIdempotencyKey } from "../../lib/easypost";
import { getInventoryScriptStatus } from "../../lib/inventory";
import { suggestProductSlug, validateProductSlug } from "../../lib/product-slug";

test("inventory script status treats stale reservation responses as inactive", () => {
  expect(getInventoryScriptStatus([1, 2, 1])).toBe("success");
  expect(getInventoryScriptStatus(["1", "2", "1"])).toBe("success");
  expect(getInventoryScriptStatus([0])).toBe("inactive");
  expect(getInventoryScriptStatus(["0"])).toBe("inactive");
  expect(getInventoryScriptStatus(null)).toBe("unknown");
});

test("EasyPost fulfillment idempotency keys are stable and header-safe", () => {
  expect(buildEasyPostFulfillmentIdempotencyKey("cs_test_123")).toBe("laem-fulfillment:cs_test_123");
  expect(buildEasyPostFulfillmentIdempotencyKey("order with spaces/unsafe")).toBe(
    "laem-fulfillment:order_with_spaces_unsafe"
  );
  expect(buildEasyPostFulfillmentIdempotencyKey("")).toBe("");
});

test("product slugs are URL-safe and predictable", () => {
  expect(validateProductSlug("silverearring-01")).toEqual({ ok: true, slug: "silverearring-01" });
  expect(validateProductSlug("Silver Earring 01").ok).toBe(false);
  expect(validateProductSlug("silver--earring").ok).toBe(false);
  expect(suggestProductSlug("Silver Earring / 01")).toBe("silver-earring-01");
});

test("admin checkout settings normalize shipping and refund defaults", () => {
  expect(normalizeCountryCodes("us, ca jp")).toEqual(["US", "CA", "JP"]);
  expect(
    validateAdminSettingsInput({
      shippingAllowedCountries: "us, ca",
      automaticTaxEnabled: true,
      shippingRateId: "shr_123",
      refundRestockDefault: false
    })
  ).toMatchObject({
    ok: true,
    settings: {
      checkout: {
        shippingAllowedCountries: ["US", "CA"],
        automaticTaxEnabled: true,
        shippingRateId: "shr_123",
        refundRestockDefault: false
      }
    }
  });
});
