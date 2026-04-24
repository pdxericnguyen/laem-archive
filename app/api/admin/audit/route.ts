import { NextResponse } from "next/server";

import { listAdminAuditEvents } from "@/lib/admin-audit";
import { requireAdminOrThrow } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") || "100");
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  const events = await listAdminAuditEvents(limit);

  return NextResponse.json({
    ok: true,
    events
  });
}
