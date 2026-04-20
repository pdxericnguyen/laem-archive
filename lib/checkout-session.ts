export const CHECKOUT_SESSION_COOKIE = "laem_checkout_session";

function cookieSecureSuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function readCookieValue(cookieHeader: string | null | undefined, keyName: string) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part.startsWith(`${keyName}=`)) {
      continue;
    }
    const rawValue = part.slice(keyName.length + 1).trim();
    if (!rawValue) {
      return null;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function isCheckoutSessionId(value: string | null | undefined): value is string {
  if (!value || typeof value !== "string") {
    return false;
  }
  return /^cs_[A-Za-z0-9_]+$/.test(value);
}

export function buildCheckoutSessionCookie(sessionId: string, maxAgeSeconds: number) {
  const maxAge = Math.max(60, Math.floor(maxAgeSeconds));
  return `${CHECKOUT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${cookieSecureSuffix()}`;
}

export function clearCheckoutSessionCookieHeader() {
  return `${CHECKOUT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${cookieSecureSuffix()}`;
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function isLikelyIpAddress(hostname: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
}

function parseOriginList(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => normalizeOrigin(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
}

function addWwwApexVariant(origin: string, target: Set<string>) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return;
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || isLikelyIpAddress(host)) {
    return;
  }

  let alternateHost: string | null = null;
  if (host.startsWith("www.")) {
    alternateHost = host.slice(4);
  } else if (host.split(".").length === 2) {
    alternateHost = `www.${host}`;
  }

  if (!alternateHost) {
    return;
  }

  url.hostname = alternateHost;
  target.add(url.origin.toLowerCase());
}

function buildAllowedOrigins(siteUrl: string, extraAllowedOrigins?: string | null) {
  const origins = new Set<string>();

  const siteOrigin = normalizeOrigin(siteUrl);
  if (siteOrigin) {
    origins.add(siteOrigin);
  }

  for (const origin of parseOriginList(extraAllowedOrigins)) {
    origins.add(origin);
  }

  for (const origin of [...origins]) {
    addWwwApexVariant(origin, origins);
  }

  return origins;
}

export function isAllowedRequestOrigin(
  originHeader: string | null | undefined,
  siteUrl: string,
  extraAllowedOrigins?: string | null
) {
  if (!originHeader) {
    return true;
  }

  const requestOrigin = normalizeOrigin(originHeader);
  const allowedOrigins = buildAllowedOrigins(siteUrl, extraAllowedOrigins);
  if (!requestOrigin || allowedOrigins.size === 0) {
    return false;
  }
  return allowedOrigins.has(requestOrigin);
}

export function shouldEnforceCheckoutOriginGuard() {
  const explicit = String(process.env.CHECKOUT_ENFORCE_ORIGIN || "").trim().toLowerCase();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}
