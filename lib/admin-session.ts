const encoder = new TextEncoder();

export const ADMIN_SESSION_COOKIE = "laem_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

function getAdminSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN;
  if (!secret) {
    throw new Error("Missing ADMIN_SESSION_SECRET or ADMIN_TOKEN");
  }
  return secret;
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

export async function createAdminSessionToken() {
  const secret = getAdminSessionSecret();
  const key = await importHmacKey(secret);

  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload = `${exp}.${bytesToBase64Url(nonce)}`;

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAdminSessionToken(token: string | null | undefined) {
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

  const secret = getAdminSessionSecret();
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
    return part.slice(keyName.length + 1);
  }

  return null;
}
