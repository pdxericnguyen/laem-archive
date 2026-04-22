import { expect, test } from "@playwright/test";

import {
  collapsePOSCartItems,
  normalizePOSCartItem,
  parsePOSCartMetadata,
  serializePOSCartMetadata,
  validatePOSCartPayload
} from "../../lib/pos";

test("POS cart helpers normalize, collapse, and round-trip metadata", () => {
  expect(normalizePOSCartItem(" silverearring-01 ", "2")).toEqual({
    slug: "silverearring-01",
    quantity: 2
  });
  expect(normalizePOSCartItem("", 1)).toBeNull();
  expect(normalizePOSCartItem("bad", 0)).toBeNull();

  const collapsed = collapsePOSCartItems([
    { slug: "a", quantity: 1 },
    { slug: "b", quantity: 2 },
    { slug: "a", quantity: 3 }
  ]);

  expect(collapsed).toEqual([
    { slug: "a", quantity: 4 },
    { slug: "b", quantity: 2 }
  ]);

  const metadata = serializePOSCartMetadata(collapsed);
  expect(metadata).toBe("a:4,b:2");
  expect(parsePOSCartMetadata(metadata)).toEqual(collapsed);
});

test("POS cart payload validation protects Stripe metadata and cart limits", () => {
  const priorDistinct = process.env.CHECKOUT_MAX_DISTINCT_ITEMS;
  const priorUnits = process.env.CHECKOUT_MAX_TOTAL_UNITS;
  const priorMetadata = process.env.CHECKOUT_MAX_METADATA_LENGTH;

  process.env.CHECKOUT_MAX_DISTINCT_ITEMS = "2";
  process.env.CHECKOUT_MAX_TOTAL_UNITS = "4";
  process.env.CHECKOUT_MAX_METADATA_LENGTH = "64";

  try {
    expect(
      validatePOSCartPayload([
        { slug: "a", quantity: 1 },
        { slug: "b", quantity: 1 },
        { slug: "c", quantity: 1 }
      ])
    ).toEqual({
      ok: false,
      error: "Too many unique items in POS cart. Maximum is 2."
    });

    expect(
      validatePOSCartPayload([
        { slug: "a", quantity: 2 },
        { slug: "b", quantity: 2 }
      ])
    ).toEqual({
      ok: true,
      cartMetadata: "a:2,b:2"
    });
  } finally {
    if (priorDistinct === undefined) {
      delete process.env.CHECKOUT_MAX_DISTINCT_ITEMS;
    } else {
      process.env.CHECKOUT_MAX_DISTINCT_ITEMS = priorDistinct;
    }

    if (priorUnits === undefined) {
      delete process.env.CHECKOUT_MAX_TOTAL_UNITS;
    } else {
      process.env.CHECKOUT_MAX_TOTAL_UNITS = priorUnits;
    }

    if (priorMetadata === undefined) {
      delete process.env.CHECKOUT_MAX_METADATA_LENGTH;
    } else {
      process.env.CHECKOUT_MAX_METADATA_LENGTH = priorMetadata;
    }
  }
});
