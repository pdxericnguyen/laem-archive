import { expect, test } from "@playwright/test";

import {
  getCheckoutLimitsFromEnv,
  serializeCartMetadata,
  validateCartMetadataSize,
  validateCheckoutLimits
} from "../../lib/checkout-validation";

test("checkout limits parse env defaults and bounds", () => {
  const defaults = getCheckoutLimitsFromEnv({});
  expect(defaults).toEqual({
    maxDistinctItems: 20,
    maxUnitsPerItem: 10,
    maxTotalUnits: 30,
    maxMetadataLength: 450
  });

  const clamped = getCheckoutLimitsFromEnv({
    CHECKOUT_MAX_DISTINCT_ITEMS: "999",
    CHECKOUT_MAX_UNITS_PER_ITEM: "0",
    CHECKOUT_MAX_TOTAL_UNITS: "501",
    CHECKOUT_MAX_METADATA_LENGTH: "12"
  });
  expect(clamped).toEqual({
    maxDistinctItems: 100,
    maxUnitsPerItem: 1,
    maxTotalUnits: 500,
    maxMetadataLength: 64
  });
});

test("checkout limits reject oversize carts and allow valid carts", () => {
  const limits = {
    maxDistinctItems: 2,
    maxUnitsPerItem: 3,
    maxTotalUnits: 4,
    maxMetadataLength: 20
  };

  expect(
    validateCheckoutLimits(
      [
        { slug: "a", quantity: 1 },
        { slug: "b", quantity: 1 },
        { slug: "c", quantity: 1 }
      ],
      limits
    )
  ).toContain("Too many unique items");

  expect(
    validateCheckoutLimits(
      [{ slug: "a", quantity: 4 }],
      limits
    )
  ).toContain("exceeds limit");

  expect(
    validateCheckoutLimits(
      [
        { slug: "a", quantity: 2 },
        { slug: "b", quantity: 3 }
      ],
      limits
    )
  ).toContain("Too many total units");

  expect(
    validateCheckoutLimits(
      [
        { slug: "a", quantity: 2 },
        { slug: "b", quantity: 2 }
      ],
      limits
    )
  ).toBeNull();
});

test("checkout metadata validation rejects oversized metadata", () => {
  const items = [
    { slug: "very-long-product-slug-1", quantity: 1 },
    { slug: "very-long-product-slug-2", quantity: 1 }
  ];

  const metadata = serializeCartMetadata(items);
  expect(metadata.length).toBeGreaterThan(10);

  const tooSmallLimit = {
    maxDistinctItems: 10,
    maxUnitsPerItem: 10,
    maxTotalUnits: 20,
    maxMetadataLength: 10
  };
  const rejected = validateCartMetadataSize(items, tooSmallLimit);
  expect(rejected.ok).toBeFalsy();

  const accepted = validateCartMetadataSize(items, {
    ...tooSmallLimit,
    maxMetadataLength: 200
  });
  expect(accepted.ok).toBeTruthy();
  if (accepted.ok) {
    expect(accepted.cartMetadata).toBe(metadata);
  }
});
