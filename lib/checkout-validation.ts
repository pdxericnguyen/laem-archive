export type CheckoutValidationItem = {
  slug: string;
  quantity: number;
};

export type CheckoutLimits = {
  maxDistinctItems: number;
  maxUnitsPerItem: number;
  maxTotalUnits: number;
  maxMetadataLength: number;
};

function asBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function getCheckoutLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): CheckoutLimits {
  return {
    maxDistinctItems: asBoundedInt(env.CHECKOUT_MAX_DISTINCT_ITEMS, 20, 1, 100),
    maxUnitsPerItem: asBoundedInt(env.CHECKOUT_MAX_UNITS_PER_ITEM, 10, 1, 100),
    maxTotalUnits: asBoundedInt(env.CHECKOUT_MAX_TOTAL_UNITS, 30, 1, 500),
    maxMetadataLength: asBoundedInt(env.CHECKOUT_MAX_METADATA_LENGTH, 450, 64, 500)
  };
}

export function validateCheckoutLimits(items: CheckoutValidationItem[], limits: CheckoutLimits) {
  if (items.length > limits.maxDistinctItems) {
    return `Too many unique items in checkout. Maximum is ${limits.maxDistinctItems}.`;
  }

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits > limits.maxTotalUnits) {
    return `Too many total units in checkout. Maximum is ${limits.maxTotalUnits}.`;
  }

  const overLimit = items.find((item) => item.quantity > limits.maxUnitsPerItem);
  if (overLimit) {
    return `Quantity for ${overLimit.slug} exceeds limit of ${limits.maxUnitsPerItem}.`;
  }

  return null;
}

export function serializeCartMetadata(items: CheckoutValidationItem[]) {
  return items.map((item) => `${item.slug}:${item.quantity}`).join(",");
}

export function validateCartMetadataSize(items: CheckoutValidationItem[], limits: CheckoutLimits) {
  const cartMetadata = serializeCartMetadata(items);
  if (cartMetadata.length > limits.maxMetadataLength) {
    return {
      ok: false as const,
      error: "Cart payload too large for checkout session metadata."
    };
  }
  return {
    ok: true as const,
    cartMetadata
  };
}
