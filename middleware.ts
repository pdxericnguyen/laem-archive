import { NextRequest, NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/admin-session";

function isAdminApiPath(pathname: string) {
  return pathname.startsWith("/api/admin");
}

function isAdminPagePath(pathname: string) {
  return pathname.startsWith("/admin");
}

function isAuthApiPath(pathname: string) {
  return pathname.startsWith("/api/admin/auth/");
}

function isWriteMethod(method: string) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isAdminApiPath(pathname) && !isAdminPagePath(pathname)) {
    return NextResponse.next();
  }

  if (isAuthApiPath(pathname)) {
    return NextResponse.next();
  }

  if (isAdminApiPath(pathname) && isWriteMethod(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Invalid origin" }, { status: 403 });
    }
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const isValid = await verifyAdminSessionToken(token);

  if (pathname === "/admin/login") {
    if (isValid) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (isValid) {
    return NextResponse.next();
  }

  if (isAdminApiPath(pathname)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
