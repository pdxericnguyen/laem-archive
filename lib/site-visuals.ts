import { hasKvEnv, key, kv } from "@/lib/kv";

export type SiteVisualPlacement =
  | "home.hero"
  | "home.promo"
  | "shop.banner"
  | "archive.banner"
  | "about.hero";

export type SiteVisualPlacementDefinition = {
  placement: SiteVisualPlacement;
  label: string;
  description: string;
};

export type SiteVisual = {
  placement: SiteVisualPlacement;
  imageUrl: string;
  altText: string;
  eyebrow: string;
  headline: string;
  body: string;
  linkHref: string;
  linkLabel: string;
  published: boolean;
  updatedAt: number;
};

export const SITE_VISUAL_PLACEMENTS: SiteVisualPlacementDefinition[] = [
  {
    placement: "home.hero",
    label: "Homepage Hero",
    description: "Primary visual near the top of the homepage."
  },
  {
    placement: "home.promo",
    label: "Homepage Promo",
    description: "Secondary campaign or collection visual on the homepage."
  },
  {
    placement: "shop.banner",
    label: "Shop Banner",
    description: "Visual banner above the product grid."
  },
  {
    placement: "archive.banner",
    label: "Archive Banner",
    description: "Visual banner above archived pieces."
  },
  {
    placement: "about.hero",
    label: "About Hero",
    description: "Studio or brand visual on the about page."
  }
];

const PLACEMENTS = new Set(SITE_VISUAL_PLACEMENTS.map((item) => item.placement));

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isSiteVisualPlacement(value: unknown): value is SiteVisualPlacement {
  return typeof value === "string" && PLACEMENTS.has(value as SiteVisualPlacement);
}

export function normalizeLinkHref(value: unknown) {
  const href = asString(value).trim();
  if (!href) {
    return "";
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    return href;
  }
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeSiteVisual(input: unknown): SiteVisual | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const row = input as Record<string, unknown>;
  if (!isSiteVisualPlacement(row.placement)) {
    return null;
  }

  const imageUrl = asString(row.imageUrl).trim();
  const headline = asString(row.headline).trim();
  const altText = asString(row.altText).trim() || headline || row.placement;

  return {
    placement: row.placement,
    imageUrl,
    altText,
    eyebrow: asString(row.eyebrow).trim(),
    headline,
    body: asString(row.body).trim(),
    linkHref: normalizeLinkHref(row.linkHref),
    linkLabel: asString(row.linkLabel).trim(),
    published: asBoolean(row.published),
    updatedAt: Math.max(0, Math.floor(asNumber(row.updatedAt)))
  };
}

export async function getSiteVisualForAdmin(placement: SiteVisualPlacement) {
  if (!hasKvEnv()) {
    return null;
  }

  const visual = await kv.get<unknown>(key.siteVisual(placement));
  return normalizeSiteVisual(visual);
}

export async function getSiteVisual(placement: SiteVisualPlacement) {
  const visual = await getSiteVisualForAdmin(placement);
  if (!visual || !visual.published || !visual.imageUrl) {
    return null;
  }
  return visual;
}

export async function getSiteVisualsForAdmin() {
  const rows = await Promise.all(
    SITE_VISUAL_PLACEMENTS.map(async (definition) => [
      definition.placement,
      await getSiteVisualForAdmin(definition.placement)
    ] as const)
  );
  return Object.fromEntries(rows) as Record<SiteVisualPlacement, SiteVisual | null>;
}

export async function saveSiteVisual(input: Omit<SiteVisual, "updatedAt">) {
  const visual: SiteVisual = {
    ...input,
    imageUrl: input.imageUrl.trim(),
    altText: input.altText.trim() || input.headline.trim() || input.placement,
    eyebrow: input.eyebrow.trim(),
    headline: input.headline.trim(),
    body: input.body.trim(),
    linkHref: normalizeLinkHref(input.linkHref),
    linkLabel: input.linkLabel.trim(),
    published: Boolean(input.published),
    updatedAt: Date.now()
  };

  await kv.set(key.siteVisual(visual.placement), visual);
  return visual;
}

export async function deleteSiteVisual(placement: SiteVisualPlacement) {
  await kv.del(key.siteVisual(placement));
}
