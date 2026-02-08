import { cookies } from "next/headers";

import {
  ADMIN_SESSION_COOKIE,
  readCookieValue,
  verifyAdminSessionToken
} from "@/lib/admin-session";

export async function requireAdminOrThrow(request?: Request) {
  let token: string | null = null;

  if (request) {
    token = readCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  }

  if (!token) {
    token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? null;
  }

  const isValid = await verifyAdminSessionToken(token);
  if (!isValid) {
    throw new Error("Unauthorized");
  }
}
