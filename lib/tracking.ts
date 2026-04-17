function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeHttpUrl(value: string) {
  const raw = asString(value);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function defaultTrackingUrl(carrier: string, trackingNumber: string) {
  const normalizedCarrier = asString(carrier).toLowerCase();
  const encodedTracking = encodeURIComponent(asString(trackingNumber));

  if (normalizedCarrier.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${encodedTracking}`;
  }
  if (normalizedCarrier.includes("usps") || normalizedCarrier.includes("postal")) {
    return `https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=${encodedTracking}`;
  }
  if (normalizedCarrier.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`;
  }
  if (normalizedCarrier.includes("dhl")) {
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodedTracking}`;
  }

  const encodedQuery = encodeURIComponent(`${carrier} tracking ${trackingNumber}`);
  return `https://www.google.com/search?q=${encodedQuery}`;
}
