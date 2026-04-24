const EASYPOST_API_BASE = "https://api.easypost.com/v2";

export type EasyPostAddressInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type EasyPostShipmentRequest = {
  toAddress: EasyPostAddressInput;
  reference: string;
  carrier?: string;
  service?: string;
  idempotencyKey?: string;
};

export type EasyPostShipmentResult =
  | {
      ok: true;
      shipmentId: string;
      rateId: string;
      carrier: string;
      service: string;
      trackingCode: string;
      labelUrl: string;
      trackerPublicUrl: string | null;
    }
  | {
      ok: false;
      error: string;
    };

type EasyPostRate = {
  id: string;
  carrier: string;
  service: string;
  rate: number;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEasyPostApiKey() {
  return asString(process.env.EASYPOST_API_KEY);
}

function normalizeCountry(value: string) {
  return value.trim().toUpperCase() || "US";
}

function getFromAddressFromEnv() {
  const street1 = asString(process.env.SHIP_FROM_LINE1);
  const city = asString(process.env.SHIP_FROM_CITY);
  const state = asString(process.env.SHIP_FROM_STATE);
  const zip = asString(process.env.SHIP_FROM_POSTAL_CODE);
  const country = normalizeCountry(asString(process.env.SHIP_FROM_COUNTRY) || "US");

  if (!street1 || !city || !state || !zip || !country) {
    return null;
  }

  return {
    name: asString(process.env.SHIP_FROM_NAME) || undefined,
    phone: asString(process.env.SHIP_FROM_PHONE) || undefined,
    email: asString(process.env.SHIP_FROM_EMAIL) || undefined,
    street1,
    street2: asString(process.env.SHIP_FROM_LINE2) || undefined,
    city,
    state,
    zip,
    country
  };
}

function getDefaultParcelFromEnv() {
  const weight = asNumber(process.env.SHIP_DEFAULT_WEIGHT_OZ) ?? 8;
  const length = asNumber(process.env.SHIP_DEFAULT_LENGTH_IN) ?? 9;
  const width = asNumber(process.env.SHIP_DEFAULT_WIDTH_IN) ?? 6;
  const height = asNumber(process.env.SHIP_DEFAULT_HEIGHT_IN) ?? 1;

  return {
    weight: Math.max(1, Number(weight.toFixed(2))),
    length: Math.max(1, Number(length.toFixed(2))),
    width: Math.max(1, Number(width.toFixed(2))),
    height: Math.max(0.25, Number(height.toFixed(2)))
  };
}

function normalizeRate(row: unknown): EasyPostRate | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const value = row as Record<string, unknown>;
  const id = asString(value.id);
  const carrier = asString(value.carrier);
  const service = asString(value.service);
  const rate = asNumber(value.rate);
  if (!id || !carrier || !service || rate === null) {
    return null;
  }

  return {
    id,
    carrier,
    service,
    rate
  };
}

function pickRate(rates: EasyPostRate[], requestedCarrier: string, requestedService: string) {
  const carrierNeedle = requestedCarrier.trim().toUpperCase();
  const serviceNeedle = requestedService.trim().toUpperCase();
  const matching = rates.filter((rate) => {
    const carrierOk = carrierNeedle ? rate.carrier.toUpperCase() === carrierNeedle : true;
    const serviceOk = serviceNeedle ? rate.service.toUpperCase() === serviceNeedle : true;
    return carrierOk && serviceOk;
  });

  const candidates = matching.length > 0 ? matching : rates;
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((a, b) => a.rate - b.rate)[0];
}

function normalizeIdempotencyKey(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  return raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 180);
}

export function buildEasyPostFulfillmentIdempotencyKey(reference: string) {
  const normalizedReference = normalizeIdempotencyKey(reference);
  return normalizedReference ? `laem-fulfillment:${normalizedReference}` : "";
}

async function easypostRequest(
  path: string,
  payload: Record<string, unknown>,
  options?: {
    idempotencyKey?: string;
  }
) {
  const apiKey = getEasyPostApiKey();
  if (!apiKey) {
    return { ok: false as const, error: "Missing EASYPOST_API_KEY." };
  }

  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const idempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
  const headers: Record<string, string> = {
    authorization,
    "content-type": "application/json"
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${EASYPOST_API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return {
      ok: false as const,
      error: `EasyPost request failed: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }

  const bodyText = await response.text().catch(() => "");
  let body: unknown = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }

  if (!response.ok) {
    return {
      ok: false as const,
      error: `EasyPost error ${response.status}: ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`
    };
  }

  return {
    ok: true as const,
    body
  };
}

export function isEasyPostConfigured() {
  return Boolean(getEasyPostApiKey() && getFromAddressFromEnv());
}

export async function createEasyPostShipmentAndBuyLabel(
  request: EasyPostShipmentRequest
): Promise<EasyPostShipmentResult> {
  const fromAddress = getFromAddressFromEnv();
  if (!fromAddress) {
    return {
      ok: false,
      error:
        "Missing SHIP_FROM_* address configuration. Required: SHIP_FROM_LINE1, CITY, STATE, POSTAL_CODE, COUNTRY."
    };
  }

  const idempotencyKey =
    normalizeIdempotencyKey(request.idempotencyKey) ||
    buildEasyPostFulfillmentIdempotencyKey(request.reference);

  const createResult = await easypostRequest(
    "/shipments",
    {
      shipment: {
        reference: request.reference,
        from_address: fromAddress,
        to_address: request.toAddress,
        parcel: getDefaultParcelFromEnv()
      }
    },
    {
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:shipment` : undefined
    }
  );

  if (!createResult.ok) {
    return {
      ok: false,
      error: createResult.error
    };
  }

  const shipment = createResult.body as Record<string, unknown>;
  const shipmentId = asString(shipment.id);
  if (!shipmentId) {
    return { ok: false, error: "EasyPost did not return a shipment id." };
  }

  const rates = Array.isArray(shipment.rates) ? shipment.rates.map(normalizeRate).filter(Boolean) : [];
  const normalizedRates = rates as EasyPostRate[];
  const selectedRate = pickRate(
    normalizedRates,
    asString(request.carrier),
    asString(request.service)
  );
  if (!selectedRate) {
    return { ok: false, error: "No EasyPost shipping rates available for this order." };
  }

  const buyResult = await easypostRequest(
    `/shipments/${shipmentId}/buy`,
    {
      rate: {
        id: selectedRate.id
      }
    },
    {
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:buy:${shipmentId}:${selectedRate.id}` : undefined
    }
  );
  if (!buyResult.ok) {
    return {
      ok: false,
      error: buyResult.error
    };
  }

  const purchased = buyResult.body as Record<string, unknown>;
  const purchasedRate = (purchased.selected_rate || {}) as Record<string, unknown>;
  const postageLabel = (purchased.postage_label || {}) as Record<string, unknown>;
  const tracker = (purchased.tracker || {}) as Record<string, unknown>;

  const trackingCode = asString(purchased.tracking_code);
  if (!trackingCode) {
    return { ok: false, error: "EasyPost did not return a tracking code." };
  }

  const labelUrl =
    asString(postageLabel.label_pdf_url) ||
    asString(postageLabel.label_url) ||
    asString(postageLabel.label_zpl_url);
  if (!labelUrl) {
    return { ok: false, error: "EasyPost did not return a printable label URL." };
  }

  return {
    ok: true,
    shipmentId,
    rateId: asString(purchasedRate.id) || selectedRate.id,
    carrier: asString(purchasedRate.carrier) || selectedRate.carrier,
    service: asString(purchasedRate.service) || selectedRate.service,
    trackingCode,
    labelUrl,
    trackerPublicUrl: asString(tracker.public_url) || null
  };
}
