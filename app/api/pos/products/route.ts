import { NextResponse } from "next/server";

import { listPOSProducts } from "@/lib/pos";
import { requirePOSOrThrow } from "@/lib/require-pos";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requirePOSOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const products = await listPOSProducts();
  return NextResponse.json({
    ok: true,
    products
  });
}
