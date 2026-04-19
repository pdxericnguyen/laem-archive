import { hasKvEnv, kv } from "@/lib/kv";

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type MemoryBucket = {
  count: number;
  expiresAt: number;
};

const MEMORY_STORE_KEY = "__laemRateLimitStore__";

function clampInt(value: number, min: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.floor(value));
}

function getMemoryStore() {
  const root = globalThis as typeof globalThis & {
    [MEMORY_STORE_KEY]?: Map<string, MemoryBucket>;
  };
  if (!root[MEMORY_STORE_KEY]) {
    root[MEMORY_STORE_KEY] = new Map<string, MemoryBucket>();
  }
  return root[MEMORY_STORE_KEY]!;
}

function parseIpCandidate(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[A-Fa-f0-9:]+$/;
  if (ipv4.test(trimmed) || ipv6.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseFirstForwardedIp(value: string | null | undefined) {
  const forwarded = typeof value === "string" ? value : "";
  if (!forwarded) {
    return null;
  }
  const first = forwarded.split(",")[0]?.trim();
  return parseIpCandidate(first);
}

function shouldTrustForwardedForHeader() {
  return String(process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR || "").trim().toLowerCase() === "true";
}

function getTrustedClientIp(request: Request) {
  const providerHeaders = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("fly-client-ip"),
    parseFirstForwardedIp(request.headers.get("x-vercel-forwarded-for")),
    request.headers.get("x-real-ip")
  ];

  for (const value of providerHeaders) {
    const parsed = parseIpCandidate(value);
    if (parsed) {
      return parsed;
    }
  }

  if (shouldTrustForwardedForHeader()) {
    const forwarded = parseFirstForwardedIp(request.headers.get("x-forwarded-for"));
    if (forwarded) {
      return forwarded;
    }
  }

  return null;
}

function getFallbackClientFingerprint(request: Request) {
  const agent = (request.headers.get("user-agent") || "unknown-agent").slice(0, 80);
  const language = (request.headers.get("accept-language") || "unknown-language")
    .split(",")[0]
    .trim()
    .slice(0, 24);
  return `anon:${agent}:${language}`;
}

export function deriveRateLimitClientId(request: Request) {
  const trustedIp = getTrustedClientIp(request);
  if (trustedIp) {
    return trustedIp;
  }
  return getFallbackClientFingerprint(request);
}

function toKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 180);
}

function buildKey(namespace: string, ip: string, bucket: number) {
  return `ratelimit:${toKeyPart(namespace)}:${toKeyPart(ip)}:${bucket}`;
}

export function getRateLimitHeaders(result: RateLimitResult) {
  return {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "retry-after": String(result.retryAfterSeconds)
  };
}

export async function applyRateLimit(
  request: Request,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();
  const limit = clampInt(options.limit, 1);
  const windowSeconds = clampInt(options.windowSeconds, 1);
  const windowMs = windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const clientId = deriveRateLimitClientId(request);
  const key = buildKey(options.namespace, clientId, bucket);
  const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));

  if (hasKvEnv()) {
    try {
      const countRaw = await kv.incr(key);
      const count = clampInt(typeof countRaw === "number" ? countRaw : Number(countRaw || 0), 0);
      if (count === 1) {
        await kv.expire(key, windowSeconds + 5);
      }
      return {
        ok: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds
      };
    } catch (error) {
      console.error("Rate limit KV error; falling back to in-memory counter", {
        namespace: options.namespace,
        error
      });
    }
  }

  const store = getMemoryStore();
  const existing = store.get(key);
  if (!existing || existing.expiresAt <= now) {
    store.set(key, { count: 1, expiresAt: now + windowMs });
    return {
      ok: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds
    };
  }

  existing.count += 1;
  store.set(key, existing);
  return {
    ok: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds
  };
}
