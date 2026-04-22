import { del as deleteBlob } from "@vercel/blob";

import { key, kv } from "@/lib/kv";
import { SITE_VISUAL_PLACEMENTS } from "@/lib/site-visuals";
import type { Product } from "@/lib/store";

export type BlobAssetReference = {
  kind: "product" | "site_visual";
  id: string;
  label: string;
};

function normalizeUrl(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isSameUrl(a: unknown, b: unknown) {
  return normalizeUrl(a) === normalizeUrl(b);
}

export async function findBlobAssetReferences(
  url: string,
  options?: {
    excludeProductSlug?: string;
    excludeSiteVisualPlacement?: string;
  }
): Promise<BlobAssetReference[]> {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) {
    return [];
  }

  const references: BlobAssetReference[] = [];
  const products = await kv.get<Product[]>(key.products);
  if (Array.isArray(products)) {
    for (const product of products) {
      if (!product?.slug || product.slug === options?.excludeProductSlug) {
        continue;
      }
      if (Array.isArray(product.images) && product.images.some((imageUrl) => isSameUrl(imageUrl, targetUrl))) {
        references.push({
          kind: "product",
          id: product.slug,
          label: product.title || product.slug
        });
      }
    }
  }

  const visuals = await Promise.all(
    SITE_VISUAL_PLACEMENTS.map(async ({ placement, label }) => ({
      placement,
      label,
      visual: await kv.get<{ imageUrl?: string }>(key.siteVisual(placement))
    }))
  );

  for (const { placement, label, visual } of visuals) {
    if (placement === options?.excludeSiteVisualPlacement) {
      continue;
    }
    if (isSameUrl(visual?.imageUrl, targetUrl)) {
      references.push({
        kind: "site_visual",
        id: placement,
        label
      });
    }
  }

  return references;
}

export async function deleteBlobIfUnreferenced(
  url: string,
  options?: {
    excludeProductSlug?: string;
    excludeSiteVisualPlacement?: string;
  }
) {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) {
    return {
      ok: false as const,
      deleted: false,
      reason: "missing_url" as const,
      references: [] as BlobAssetReference[]
    };
  }

  const references = await findBlobAssetReferences(targetUrl, options);
  if (references.length > 0) {
    return {
      ok: false as const,
      deleted: false,
      reason: "referenced" as const,
      references
    };
  }

  await deleteBlob(targetUrl);
  return {
    ok: true as const,
    deleted: true,
    references
  };
}
