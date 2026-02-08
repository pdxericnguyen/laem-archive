import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken
} from "@/lib/admin-session";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

type LoginPayload = {
  password?: unknown;
};

async function readPassword(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as LoginPayload | null;
    return typeof body?.password === "string" ? body.password : "";
  }

  const formData = await request.formData();
  const password = formData.get("password");
  return typeof password === "string" ? password : "";
}

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "admin-login",
    limit: asPositiveInt(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    windowSeconds: asPositiveInt(process.env.RATE_LIMIT_LOGIN_WINDOW_SECONDS, 300)
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many login attempts. Try again shortly." },
      { status: 429, headers: rateLimitHeaders }
    );
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "Missing ADMIN_TOKEN" },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  const password = (await readPassword(request)).trim();
  if (!password || password !== adminToken) {
    return NextResponse.json(
      { ok: false, error: "Invalid credentials" },
      { status: 401, headers: rateLimitHeaders }
    );
  }

  const sessionToken = await createAdminSessionToken();
  const response = NextResponse.json({ ok: true }, { headers: rateLimitHeaders });

  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS
  });

  return response;
}
