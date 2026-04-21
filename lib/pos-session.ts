const encoder = new TextEncoder();

const DEFAULT_POS_SESSION_TTL_SECONDS = 60 * 60 * 12;

function getPOSLoginToken() {
  const secret = process.env.POS_APP_TOKEN || process.env.ADMIN_TOKEN;
  if (!secret) {
    throw new Error("Missing POS_APP_TOKEN or ADMIN_TOKEN");
  }
  return secret;
}

function getPOSSessionSecret() {
  const secret =
    process.env.POS_SESSION_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.POS_APP_TOKEN ||
    process.env.ADMIN_TOKEN;
  if (!secret) {
    throw new Error(
      "Missing POS_SESSION_SECRET, ADMIN_SESSION_SECRET, POS_APP_TOKEN, or ADMIN_TOKEN"
    );
  }
  return secret;
}

function getPOSSessionTtlSeconds() {
  const raw = Number(process.env.POS_SESSION_TTL_SECONDS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_POS_SESSION_TTL_SECONDS;
  }
  return Math.max(60, Math.floor(raw));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value + "=".repeat((4 - (value.length % 4 || 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function parseToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const exp = Number(parts[0]);
  const nonce = parts[1];
  const signature = parts[2];
  if (!Number.isInteger(exp) || !nonce || !signature) {
    return null;
  }

  return {
    exp,
    payload: `${parts[0]}.${parts[1]}`,
    signature
  };
}

export function readAuthorizationBearer(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [scheme, token] = value.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

export function verifyPOSLoginPassword(password: string) {
  return password === getPOSLoginToken();
}

export async function createPOSSessionToken() {
  const secret = getPOSSessionSecret();
  const key = await importHmacKey(secret);

  const expiresAt = Math.floor(Date.now() / 1000) + getPOSSessionTtlSeconds();
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload = `${expiresAt}.${bytesToBase64Url(nonce)}`;

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return {
    token: `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`,
    expiresAt
  };
}

export async function verifyPOSSessionToken(token: string | null | undefined) {
  if (!token) {
    return false;
  }

  const parsed = parseToken(token);
  if (!parsed) {
    return false;
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const secret = getPOSSessionSecret();
  const key = await importHmacKey(secret);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(parsed.signature);
  } catch {
    return false;
  }

  const signatureBuffer = new Uint8Array(signatureBytes).buffer;
  return crypto.subtle.verify("HMAC", key, signatureBuffer, encoder.encode(parsed.payload));
}
