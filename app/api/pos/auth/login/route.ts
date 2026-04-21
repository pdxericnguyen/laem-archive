import { NextResponse } from "next/server";

import { createPOSSessionToken, verifyPOSLoginPassword } from "@/lib/pos-session";
import { applyRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

type LoginPayload = {
  password?: unknown;
};

function asPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

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

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, {
    namespace: "pos-login",
    limit: asPositiveInt(process.env.RATE_LIMIT_POS_LOGIN_MAX || process.env.RATE_LIMIT_LOGIN_MAX, 10),
    windowSeconds: asPositiveInt(
      process.env.RATE_LIMIT_POS_LOGIN_WINDOW_SECONDS || process.env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
      300
    )
  });
  const rateLimitHeaders = getRateLimitHeaders(rateLimit);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many POS login attempts. Try again shortly." },
      { status: 429, headers: rateLimitHeaders }
    );
  }

  const password = (await readPassword(request)).trim();
  let isValid = false;
  try {
    isValid = !!password && verifyPOSLoginPassword(password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify credentials";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  if (!isValid) {
    return NextResponse.json(
      { ok: false, error: "Invalid credentials" },
      { status: 401, headers: rateLimitHeaders }
    );
  }

  let session: { token: string; expiresAt: number };
  try {
    session = await createPOSSessionToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create POS session";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt
    },
    {
      headers: rateLimitHeaders
    }
  );
}
