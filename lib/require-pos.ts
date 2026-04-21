import { ADMIN_SESSION_COOKIE, readCookieValue, verifyAdminSessionToken } from "@/lib/admin-session";
import { readAuthorizationBearer, verifyPOSSessionToken } from "@/lib/pos-session";

export async function requirePOSOrThrow(request: Request) {
  const bearer = readAuthorizationBearer(request.headers.get("authorization"));
  if (bearer && (await verifyPOSSessionToken(bearer))) {
    return;
  }

  const adminToken = readCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  if (adminToken && (await verifyAdminSessionToken(adminToken))) {
    return;
  }

  throw new Error("Unauthorized");
}
