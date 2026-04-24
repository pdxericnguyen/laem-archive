export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRODUCT_SLUG_MAX_LENGTH = 80;

export type ProductSlugValidationResult =
  | {
      ok: true;
      slug: string;
    }
  | {
      ok: false;
      slug: string;
      error: string;
    };

export function normalizeProductSlugInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function suggestProductSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, PRODUCT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function validateProductSlug(value: unknown): ProductSlugValidationResult {
  const slug = normalizeProductSlugInput(value);
  if (!slug) {
    return {
      ok: false,
      slug,
      error: "Slug is required."
    };
  }

  if (slug.length > PRODUCT_SLUG_MAX_LENGTH) {
    return {
      ok: false,
      slug,
      error: `Slug must be ${PRODUCT_SLUG_MAX_LENGTH} characters or fewer.`
    };
  }

  if (!PRODUCT_SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      slug,
      error: "Use lowercase letters, numbers, and single hyphens only."
    };
  }

  return {
    ok: true,
    slug
  };
}
