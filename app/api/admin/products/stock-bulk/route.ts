import { NextResponse } from "next/server";

import { setStock, syncProductStockAndArchiveState } from "@/lib/inventory";
import { hasKvEnv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";

type BulkStockPayload = {
  updates?: Array<{ slug?: string; stock?: number }>;
};

function sanitizeUpdates(payload: BulkStockPayload) {
  if (!Array.isArray(payload.updates)) {
    return [];
  }

  return payload.updates
    .map((item) => {
      const slug = typeof item.slug === "string" ? item.slug.trim() : "";
      const stockValue = typeof item.stock === "number" ? item.stock : Number(item.stock ?? 0);
      if (!slug || !Number.isFinite(stockValue)) {
        return null;
      }

      return {
        slug,
        stock: Math.max(0, Math.floor(stockValue))
      };
    })
    .filter((item): item is { slug: string; stock: number } => Boolean(item));
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasKvEnv()) {
    return new Response("Missing KV configuration", { status: 500 });
  }

  const payload = (await request.json().catch(() => null)) as BulkStockPayload | null;
  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const updates = sanitizeUpdates(payload);
  if (updates.length === 0) {
    return new Response("No valid stock updates", { status: 400 });
  }
  let autoArchived = 0;

  for (const update of updates) {
    await setStock(update.slug, update.stock);
    const synced = await syncProductStockAndArchiveState(update.slug, update.stock);
    if (synced?.autoArchiveOnZero && synced.archived && update.stock <= 0) {
      autoArchived += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    updated: updates.length,
    autoArchived,
    rows: updates
  });
}
