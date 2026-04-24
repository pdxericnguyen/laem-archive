import { hasKvEnv, key, kv } from "@/lib/kv";

export type AdminCheckoutSettings = {
  shippingAllowedCountries: string[];
  automaticTaxEnabled: boolean;
  shippingRateId: string | null;
  refundRestockDefault: boolean;
  updatedAt?: number;
};

export type AdminSettings = {
  checkout: AdminCheckoutSettings;
};

type LooseAdminSettings = {
  checkout?: Partial<AdminCheckoutSettings> | null;
};

const DEFAULT_ALLOWED_COUNTRIES = ["US"];
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const SHIPPING_RATE_PATTERN = /^shr_[A-Za-z0-9_]+$/;

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

export function normalizeCountryCodes(value: unknown) {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];

  const countries = rows
    .map((row) => (typeof row === "string" ? row.trim().toUpperCase() : ""))
    .filter((row) => COUNTRY_CODE_PATTERN.test(row));

  return [...new Set(countries)].slice(0, 25);
}

export function normalizeShippingRateId(value: unknown) {
  const rateId = typeof value === "string" ? value.trim() : "";
  if (!rateId) {
    return null;
  }
  return SHIPPING_RATE_PATTERN.test(rateId) ? rateId : null;
}

export function getDefaultAdminSettings(): AdminSettings {
  const shippingAllowedCountries =
    normalizeCountryCodes(process.env.STRIPE_SHIPPING_ALLOWED_COUNTRIES) || DEFAULT_ALLOWED_COUNTRIES;

  return {
    checkout: {
      shippingAllowedCountries:
        shippingAllowedCountries.length > 0 ? shippingAllowedCountries : DEFAULT_ALLOWED_COUNTRIES,
      automaticTaxEnabled: parseBooleanEnv("STRIPE_AUTOMATIC_TAX_ENABLED", false),
      shippingRateId: normalizeShippingRateId(process.env.STRIPE_SHIPPING_RATE_ID),
      refundRestockDefault: parseBooleanEnv("ADMIN_REFUND_RESTOCK_DEFAULT", true)
    }
  };
}

export function normalizeAdminSettings(input: unknown): AdminSettings {
  const defaults = getDefaultAdminSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  const raw = input as LooseAdminSettings;
  const checkout = raw.checkout && typeof raw.checkout === "object" ? raw.checkout : {};
  const shippingAllowedCountries = normalizeCountryCodes(checkout.shippingAllowedCountries);
  const hasShippingRateId = Object.prototype.hasOwnProperty.call(checkout, "shippingRateId");
  const updatedAt =
    typeof checkout.updatedAt === "number" && Number.isFinite(checkout.updatedAt)
      ? Math.floor(checkout.updatedAt)
      : undefined;

  return {
    checkout: {
      shippingAllowedCountries:
        shippingAllowedCountries.length > 0
          ? shippingAllowedCountries
          : defaults.checkout.shippingAllowedCountries,
      automaticTaxEnabled:
        typeof checkout.automaticTaxEnabled === "boolean"
          ? checkout.automaticTaxEnabled
          : defaults.checkout.automaticTaxEnabled,
      shippingRateId: hasShippingRateId
        ? normalizeShippingRateId(checkout.shippingRateId)
        : defaults.checkout.shippingRateId,
      refundRestockDefault:
        typeof checkout.refundRestockDefault === "boolean"
          ? checkout.refundRestockDefault
          : defaults.checkout.refundRestockDefault,
      updatedAt
    }
  };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  if (!hasKvEnv()) {
    return getDefaultAdminSettings();
  }

  const stored = await kv.get<unknown>(key.adminSettings).catch(() => null);
  return normalizeAdminSettings(stored);
}

export async function saveAdminSettings(settings: AdminSettings) {
  const normalized = normalizeAdminSettings({
    checkout: {
      ...settings.checkout,
      updatedAt: Math.floor(Date.now() / 1000)
    }
  });

  await kv.set(key.adminSettings, normalized);
  return normalized;
}

export function validateAdminSettingsInput(input: {
  shippingAllowedCountries: unknown;
  automaticTaxEnabled: boolean;
  shippingRateId: unknown;
  refundRestockDefault: boolean;
}) {
  const shippingAllowedCountries = normalizeCountryCodes(input.shippingAllowedCountries);
  if (shippingAllowedCountries.length === 0) {
    return {
      ok: false as const,
      error: "Enter at least one two-letter country code."
    };
  }

  const rawRateId = typeof input.shippingRateId === "string" ? input.shippingRateId.trim() : "";
  const shippingRateId = normalizeShippingRateId(rawRateId);
  if (rawRateId && !shippingRateId) {
    return {
      ok: false as const,
      error: "Stripe shipping rate IDs should look like shr_..."
    };
  }

  return {
    ok: true as const,
    settings: normalizeAdminSettings({
      checkout: {
        shippingAllowedCountries,
        automaticTaxEnabled: input.automaticTaxEnabled,
        shippingRateId,
        refundRestockDefault: input.refundRestockDefault
      }
    })
  };
}

export function adminSettingsHasStripeTaxEnvWarning(settings: AdminSettings) {
  return settings.checkout.automaticTaxEnabled && !hasEnv("STRIPE_SECRET_KEY");
}
