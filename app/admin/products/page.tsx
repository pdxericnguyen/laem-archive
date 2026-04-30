import { getStock, summarizeReservationHoldsForSlugs, type ReservationHoldSummary } from "@/lib/inventory";
import { getAdminFilterCountClass, getAdminFilterTabClass } from "@/lib/admin-ui";
import { hasKvEnv, kv } from "@/lib/kv";
import type { Product, ProductCategory } from "@/lib/store";
import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import UnsavedChangesGuard from "../unsaved-changes-guard";
import BulkStockEditor from "./stock-bulk";
import ImageUploadField from "./image-upload-field";

export const dynamic = "force-dynamic";

type AdminProductsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ProductStatus = "live" | "archived" | "hidden";
type ProductFilterStatus = "all" | ProductStatus | "sold-out";
type ProductCategoryFilter = "all" | ProductCategory | "uncategorized";

type ProductStatusBadge = {
  label: string;
  className: string;
};

type FilterOption = {
  value: ProductFilterStatus;
  label: string;
};

type CategoryFilterOption = {
  value: ProductCategoryFilter;
  label: string;
};

type ProductsViewState = {
  status: ProductFilterStatus;
  category: ProductCategoryFilter;
  query: string;
};

type ProductsFlashParams = {
  deletedSlug: string | null;
  deleteError: DeleteErrorCode | null;
  deleteSlug: string | null;
  deleteReservedStock: number | null;
  deleteActiveCheckoutCount: number | null;
  deleteLastExpiresAt: number | null;
  saveError: SaveErrorCode | null;
  saveSlug: string | null;
};

const PRODUCT_CATEGORY_OPTIONS: Array<{ value: ProductCategory; label: string }> = [
  { value: "clothing", label: "Clothing" },
  { value: "accessories", label: "Accessories" },
  { value: "jewelry", label: "Jewelry" }
];

type DeleteErrorCode = "live" | "reserved";
type SaveErrorCode = "slug_locked" | "slug_reserved" | "slug_taken" | "invalid_live_price" | "invalid_slug";

type ProductRow = {
  product: Product;
  stock: number;
  holdSummary: ReservationHoldSummary;
};

function formatPriceInput(priceCents: number) {
  return (Math.max(0, priceCents) / 100).toFixed(2);
}

function getProductStatus(product: Product): ProductStatus {
  if (!product.published) {
    return "hidden";
  }
  return product.archived ? "archived" : "live";
}

function getProductFilterStatus(product: Product, stock: number): Exclude<ProductFilterStatus, "all"> {
  const status = getProductStatus(product);
  if (status === "hidden" || status === "archived") {
    return status;
  }
  return stock <= 0 ? "sold-out" : "live";
}

function getProductStatusBadge(product: Product, stock: number): ProductStatusBadge {
  const status = getProductFilterStatus(product, stock);

  if (status === "hidden") {
    return {
      label: "Hidden",
      className: "border-neutral-300 bg-neutral-100 text-neutral-700"
    };
  }

  if (status === "archived") {
    return {
      label: "Archived",
      className: "border-amber-300 bg-amber-50 text-amber-800"
    };
  }

  if (stock <= 0) {
    return {
      label: "Sold out",
      className: "border-rose-300 bg-rose-50 text-rose-800"
    };
  }

  return {
    label: "Live",
    className: "border-emerald-300 bg-emerald-50 text-emerald-800"
  };
}

function parseFilterStatus(value: string | string[] | undefined): ProductFilterStatus {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "live" || raw === "sold-out" || raw === "archived" || raw === "hidden" ? raw : "all";
}

function parseCategoryFilter(value: string | string[] | undefined): ProductCategoryFilter {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "clothing" || raw === "accessories" || raw === "jewelry" || raw === "uncategorized"
    ? raw
    : "all";
}

function parseSearchQuery(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw.trim().slice(0, 80);
}

function parseDeleteErrorCode(value: string | string[] | undefined): DeleteErrorCode | null {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "live" || raw === "reserved" ? raw : null;
}

function parseSaveErrorCode(value: string | string[] | undefined): SaveErrorCode | null {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "slug_locked" ||
    raw === "slug_reserved" ||
    raw === "slug_taken" ||
    raw === "invalid_slug" ||
    raw === "invalid_live_price"
    ? raw
    : null;
}

function parseOptionalPositiveInt(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function formatHoldDeadline(expiresAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(expiresAt * 1000));
}

function formatMinutesRemaining(expiresAt: number, nowMs: number) {
  const deltaMs = expiresAt * 1000 - nowMs;
  if (deltaMs <= 0) {
    return "now";
  }

  const minutes = Math.ceil(deltaMs / 60000);
  if (minutes === 1) {
    return "about 1 minute";
  }
  if (minutes < 60) {
    return `about ${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
  }

  const hourLabel = hours === 1 ? "1 hour" : `${hours} hours`;
  const minuteLabel = remainingMinutes === 1 ? "1 minute" : `${remainingMinutes} minutes`;
  return `about ${hourLabel} ${minuteLabel}`;
}

function describeHoldWindow(holdSummary: ReservationHoldSummary, nowMs: number) {
  if (!holdSummary.lastExpiresAt) {
    return null;
  }

  const deadline = formatHoldDeadline(holdSummary.lastExpiresAt);
  const remaining = formatMinutesRemaining(holdSummary.lastExpiresAt, nowMs);

  if (holdSummary.activeCheckoutCount > 1) {
    return `Last hold expires ${deadline} (${remaining} left if none complete first).`;
  }

  return `Hold expires ${deadline} (${remaining} left).`;
}

function getCategoryLabel(category: ProductCategoryFilter) {
  if (category === "all") {
    return "All Categories";
  }
  if (category === "uncategorized") {
    return "Uncategorized";
  }
  return PRODUCT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label || "Category";
}

function matchesCategoryFilter(product: Product, category: ProductCategoryFilter) {
  if (category === "all") {
    return true;
  }
  if (category === "uncategorized") {
    return !product.category;
  }
  return product.category === category;
}

function matchesSearchQuery(product: Product, query: string) {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  return [
    product.title,
    product.slug,
    product.subtitle,
    product.category || ""
  ].some((value) => value.toLowerCase().includes(needle));
}

function addFlashParams(params: URLSearchParams, flash: ProductsFlashParams) {
  if (flash.deletedSlug) {
    params.set("deleted", flash.deletedSlug);
  }
  if (flash.deleteError && flash.deleteSlug) {
    params.set("deleteError", flash.deleteError);
    params.set("deleteSlug", flash.deleteSlug);
    if (flash.deleteReservedStock) {
      params.set("deleteReservedStock", String(flash.deleteReservedStock));
    }
    if (flash.deleteActiveCheckoutCount) {
      params.set("deleteActiveCheckoutCount", String(flash.deleteActiveCheckoutCount));
    }
    if (flash.deleteLastExpiresAt) {
      params.set("deleteLastExpiresAt", String(flash.deleteLastExpiresAt));
    }
  }
  if (flash.saveError && flash.saveSlug) {
    params.set("saveError", flash.saveError);
    params.set("saveSlug", flash.saveSlug);
  }
}

function buildProductsHref(view: ProductsViewState, flash: ProductsFlashParams) {
  const params = new URLSearchParams();
  if (view.status !== "all") {
    params.set("status", view.status);
  }
  if (view.category !== "all") {
    params.set("category", view.category);
  }
  if (view.query) {
    params.set("q", view.query);
  }
  addFlashParams(params, flash);
  const query = params.toString();
  return query ? `/admin/products?${query}` : "/admin/products";
}

function getDeleteErrorMessage(
  deleteError: DeleteErrorCode | null,
  deleteSlug: string | null,
  details: {
    reservedStock: number | null;
    activeCheckoutCount: number | null;
    lastExpiresAt: number | null;
  },
  nowMs: number
) {
  if (!deleteError || !deleteSlug) {
    return null;
  }

  if (deleteError === "live") {
    return (
      <>
        You can&apos;t delete <code>{deleteSlug}</code> while it is live. Set the listing to{" "}
        <span className="font-semibold">Hidden</span> or <span className="font-semibold">Archived</span>, update it,
        then return to delete it permanently.
      </>
    );
  }

  return (
    <>
      You can&apos;t delete <code>{deleteSlug}</code> yet because{" "}
      {details.reservedStock ? (
        <>
          {details.reservedStock} item{details.reservedStock === 1 ? "" : "s"} {details.reservedStock === 1 ? "is" : "are"}
        </>
      ) : (
        <>inventory is</>
      )}{" "}
      still held in checkout. Hidden or archived listings stay protected until that checkout completes or expires.
      {details.lastExpiresAt ? ` ${describeHoldWindow(
        {
          reservedStock: details.reservedStock || 0,
          activeCheckoutCount: details.activeCheckoutCount || 1,
          lastExpiresAt: details.lastExpiresAt
        },
        nowMs
      )}` : ""}
    </>
  );
}

function getSaveErrorMessage(saveError: SaveErrorCode | null, saveSlug: string | null) {
  if (!saveError) {
    return null;
  }

  if (saveError === "invalid_live_price") {
    return (
      <>
        {saveSlug ? (
          <>
            <code>{saveSlug}</code> can&apos;t be set live with its current price.
          </>
        ) : (
          <>That product can&apos;t be set live with its current price.</>
        )}{" "}
        Live products must be priced at <span className="font-semibold">$0.50 or higher</span>.
      </>
    );
  }

  if (!saveSlug) {
    return null;
  }

  if (saveError === "slug_reserved") {
    return (
      <>
        You can&apos;t rename <code>{saveSlug}</code> while inventory is reserved by an in-progress checkout.
        Wait for that checkout to complete or expire, then rename it.
      </>
    );
  }

  if (saveError === "slug_taken") {
    return (
      <>
        <code>{saveSlug}</code> is already used by another listing. Choose a unique slug before saving.
      </>
    );
  }

  if (saveError === "invalid_slug") {
    return (
      <>
        <code>{saveSlug}</code> is not a valid product slug. Use lowercase letters, numbers, and single hyphens only.
      </>
    );
  }

  return (
    <>
      You can&apos;t change the slug for <code>{saveSlug}</code> while it is live. Hide or archive the listing first,
      update it, then you can rename the slug if needed.
    </>
  );
}

async function getProducts(): Promise<Product[]> {
  if (!hasKvEnv()) {
    return [];
  }
  const products = await kv.get<Product[]>("products");
  return Array.isArray(products) ? products : [];
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  if (!hasKvEnv()) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 space-y-4">
        <AdminSystemHealthBanner />
        <h1 className="text-lg font-semibold tracking-tight">Admin Products</h1>
        <AdminCommandPalette />
        <p className="text-sm text-neutral-600">Redis is not configured.</p>
      </main>
    );
  }

  const products = await getProducts();
  const [holdSummariesBySlug, stockRows] = await Promise.all([
    summarizeReservationHoldsForSlugs(products.map((product) => product.slug)),
    Promise.all(products.map(async (product) => [product.slug, await getStock(product.slug)] as const))
  ]);
  const stockBySlug = Object.fromEntries(stockRows);
  const productRows: ProductRow[] = products.map((product) => ({
    product,
    stock: stockBySlug[product.slug] || 0,
    holdSummary: holdSummariesBySlug[product.slug] || {
      reservedStock: 0,
      activeCheckoutCount: 0
    }
  }));
  const resolvedSearchParams = (await searchParams) || {};
  const nowMs = Date.now();
  const deletedSlug = typeof resolvedSearchParams.deleted === "string" ? resolvedSearchParams.deleted : null;
  const deleteError = parseDeleteErrorCode(resolvedSearchParams.deleteError);
  const deleteSlug = typeof resolvedSearchParams.deleteSlug === "string" ? resolvedSearchParams.deleteSlug : null;
  const deleteReservedStock = parseOptionalPositiveInt(resolvedSearchParams.deleteReservedStock);
  const deleteActiveCheckoutCount = parseOptionalPositiveInt(resolvedSearchParams.deleteActiveCheckoutCount);
  const deleteLastExpiresAt = parseOptionalPositiveInt(resolvedSearchParams.deleteLastExpiresAt);
  const deleteErrorMessage = getDeleteErrorMessage(
    deleteError,
    deleteSlug,
    {
      reservedStock: deleteReservedStock,
      activeCheckoutCount: deleteActiveCheckoutCount,
      lastExpiresAt: deleteLastExpiresAt
    },
    nowMs
  );
  const saveError = parseSaveErrorCode(resolvedSearchParams.saveError);
  const saveSlug = typeof resolvedSearchParams.saveSlug === "string" ? resolvedSearchParams.saveSlug : null;
  const saveErrorMessage = getSaveErrorMessage(saveError, saveSlug);
  const activeFilter = parseFilterStatus(resolvedSearchParams.status);
  const activeCategory = parseCategoryFilter(resolvedSearchParams.category);
  const searchQuery = parseSearchQuery(resolvedSearchParams.q);
  const filterOptions: FilterOption[] = [
    { value: "all", label: "All" },
    { value: "live", label: "Live" },
    { value: "sold-out", label: "Sold out" },
    { value: "archived", label: "Archived" },
    { value: "hidden", label: "Hidden" }
  ];
  const categoryOptions: CategoryFilterOption[] = [
    { value: "all", label: "All Categories" },
    ...PRODUCT_CATEGORY_OPTIONS,
    { value: "uncategorized", label: "Uncategorized" }
  ];
  const flashParams: ProductsFlashParams = {
    deletedSlug,
    deleteError,
    deleteSlug,
    deleteReservedStock,
    deleteActiveCheckoutCount,
    deleteLastExpiresAt,
    saveError,
    saveSlug
  };
  const filterCounts = {
    all: productRows.length,
    live: productRows.filter(({ product, stock }) => getProductFilterStatus(product, stock) === "live").length,
    "sold-out": productRows.filter(({ product, stock }) => getProductFilterStatus(product, stock) === "sold-out").length,
    archived: productRows.filter(({ product, stock }) => getProductFilterStatus(product, stock) === "archived").length,
    hidden: productRows.filter(({ product, stock }) => getProductFilterStatus(product, stock) === "hidden").length
  };
  const statusFilteredRows =
    activeFilter === "all"
      ? productRows
      : productRows.filter(({ product, stock }) => getProductFilterStatus(product, stock) === activeFilter);
  const categoryCounts = {
    all: statusFilteredRows.length,
    clothing: statusFilteredRows.filter(({ product }) => product.category === "clothing").length,
    accessories: statusFilteredRows.filter(({ product }) => product.category === "accessories").length,
    jewelry: statusFilteredRows.filter(({ product }) => product.category === "jewelry").length,
    uncategorized: statusFilteredRows.filter(({ product }) => !product.category).length
  };
  const filteredRows = statusFilteredRows
    .filter(({ product }) => matchesCategoryFilter(product, activeCategory))
    .filter(({ product }) => matchesSearchQuery(product, searchQuery));
  const activeFilterLabel = filterOptions.find((option) => option.value === activeFilter)?.label || "All";
  const activeCategoryLabel = getCategoryLabel(activeCategory);
  const hasProductSearch = Boolean(searchQuery || activeCategory !== "all" || activeFilter !== "all");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-10">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Admin Products</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="text-sm text-neutral-600">Manage product publishing and stock.</p>
        {deletedSlug ? (
          <p className="text-sm text-emerald-700">Deleted listing: <code>{deletedSlug}</code></p>
        ) : null}
        {deleteErrorMessage ? (
          <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {deleteErrorMessage}
          </div>
        ) : null}
        {saveErrorMessage ? (
          <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {saveErrorMessage}
          </div>
        ) : null}
      </header>
      <AdminCommandPalette />
      <UnsavedChangesGuard selector='form[action="/api/admin/products/save"]' />

      <section className="border border-neutral-200 p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Find Products</h2>
            <p className="text-xs text-neutral-500">
              Search and filter existing products without changing the full add-product flow below.
            </p>
          </div>
          {hasProductSearch ? (
            <a
              href={buildProductsHref(
                { status: "all", category: "all", query: "" },
                flashParams
              )}
              className="inline-flex h-9 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
            >
              Clear Filters
            </a>
          ) : null}
        </div>

        <form action="/admin/products" method="GET" className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          {activeFilter !== "all" ? <input type="hidden" name="status" value={activeFilter} /> : null}
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Search</span>
            <input
              name="q"
              defaultValue={searchQuery}
              className="h-10 border border-neutral-300 px-3 text-sm"
              placeholder="Title, slug, subtitle"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Category</span>
            <select
              name="category"
              defaultValue={activeCategory}
              className="h-10 border border-neutral-300 bg-white px-3 text-sm"
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({categoryCounts[option.value]})
                </option>
              ))}
            </select>
          </label>
          <button className="h-10 self-end border border-neutral-300 px-4 text-xs font-semibold uppercase tracking-[0.12em] hover:bg-neutral-50">
            Apply
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const isActive = option.value === activeFilter;
            return (
              <a
                key={option.value}
                href={buildProductsHref(
                  {
                    status: option.value,
                    category: activeCategory,
                    query: searchQuery
                  },
                  flashParams
                )}
                className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] no-underline transition-colors ${getAdminFilterTabClass(
                  isActive
                )}`}
              >
                <span>{option.label}</span>
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${getAdminFilterCountClass(
                    isActive
                  )}`}
                >
                  {filterCounts[option.value]}
                </span>
              </a>
            );
          })}
        </div>
        <p className="text-xs text-neutral-500">
          Showing <span className="font-semibold text-neutral-700">{filteredRows.length}</span> of{" "}
          <span className="font-semibold text-neutral-700">{productRows.length}</span> products
          {activeFilter !== "all" ? <> in <span className="font-semibold text-neutral-700">{activeFilterLabel}</span></> : null}
          {activeCategory !== "all" ? <> for <span className="font-semibold text-neutral-700">{activeCategoryLabel}</span></> : null}
          {searchQuery ? <> matching <span className="font-semibold text-neutral-700">&quot;{searchQuery}&quot;</span></> : null}.
        </p>
      </section>

      <BulkStockEditor
        rows={filteredRows.map(({ product, stock }) => ({
          slug: product.slug,
          title: product.title,
          stock
        }))}
      />

      <section className="border border-neutral-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Add Product</h2>
        <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
          <input type="hidden" name="returnStatusFilter" value={activeFilter} />
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Slug</span>
            <input
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              title="Use lowercase letters, numbers, and single hyphens only."
              className="h-10 border border-neutral-300 px-3"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Title</span>
            <input name="title" required className="h-10 border border-neutral-300 px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Subtitle</span>
            <input name="subtitle" className="h-10 border border-neutral-300 px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Category</span>
            <select
              name="category"
              defaultValue="jewelry"
              className="h-10 border border-neutral-300 bg-white px-3"
            >
              {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Description</span>
            <textarea name="description" rows={3} className="border border-neutral-300 p-3" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Price (USD)</span>
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="h-10 border border-neutral-300 px-3"
                placeholder="125.00"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Stock</span>
              <input name="stock" type="number" min="0" step="1" className="h-10 border border-neutral-300 px-3" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Status</span>
              <select
                name="status"
                defaultValue="live"
                className="h-10 border border-neutral-300 bg-white px-3"
              >
                <option value="live">Live</option>
                <option value="archived">Archived</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Automation</span>
              <span className="flex h-10 items-center gap-2 border border-neutral-300 px-3 text-xs uppercase tracking-[0.12em] text-neutral-500">
                <input name="autoArchiveOnZero" type="checkbox" />
                Auto-archive at zero stock
              </span>
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Live shows in shop. Archived moves the piece to the archive page. Hidden removes it from public pages.
            Stock controls quantity; Status controls public availability.
          </p>
          <ImageUploadField name="images" ownerType="product" />
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Materials</span>
            <textarea name="materials" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Dimensions</span>
            <textarea name="dimensions" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Care</span>
            <textarea name="care" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Shipping & Returns</span>
            <textarea name="shippingReturns" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <button className="h-11 border border-neutral-300 font-semibold hover:bg-neutral-50">
            Save Product
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Existing Products</h2>
            <p className="text-xs text-neutral-500">
              Compact rows stay closed for scanning. Open a row when you need the full editor.
            </p>
          </div>
          <span className="border border-neutral-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-600">
            {filteredRows.length} shown
          </span>
        </div>
        {filteredRows.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-600">
            {hasProductSearch
              ? "No products match the current filters."
              : activeFilter === "all"
                ? "No products yet."
                : `No ${activeFilterLabel.toLowerCase()} products yet.`}
          </div>
        ) : (
          filteredRows.map(({ product, stock, holdSummary }) => {
            const statusBadge = getProductStatusBadge(product, stock);
            const productStatus = getProductStatus(product);
            const slugLocked = productStatus === "live";
            const deleteBlockedByLive = productStatus === "live";
            const reservedStock = holdSummary.reservedStock;
            const deleteBlockedByReservation = reservedStock > 0;
            const deleteBlocked = deleteBlockedByLive || deleteBlockedByReservation;
            const holdWindow = describeHoldWindow(holdSummary, nowMs);
            const deleteGuidance = deleteBlockedByLive
              ? (
                  <>
                    To permanently delete this listing: first change <span className="font-semibold">Status</span> to{" "}
                    <span className="font-semibold">Hidden</span> or <span className="font-semibold">Archived</span>,
                    click <span className="font-semibold">Update Product</span>, then return here to delete it.
                  </>
                )
              : deleteBlockedByReservation
                ? (
                    <>
                      Deletion is temporarily blocked because {reservedStock} item{reservedStock === 1 ? "" : "s"}{" "}
                      {reservedStock === 1 ? "is" : "are"} still held in{" "}
                      {holdSummary.activeCheckoutCount > 1 ? `${holdSummary.activeCheckoutCount} checkout sessions` : "checkout"}.
                      Hidden or archived listings can&apos;t be deleted until that checkout completes or expires.
                      {holdWindow ? ` ${holdWindow}` : ""}
                    </>
                  )
                : (
                    <>
                      This listing is no longer public and can now be permanently removed from Redis. Type the slug
                      exactly to confirm deletion.
                    </>
                  );
            const categoryLabel = product.category
              ? PRODUCT_CATEGORY_OPTIONS.find((option) => option.value === product.category)?.label || product.category
              : "Uncategorized";
            const thumbnailUrl = product.images.find(Boolean);
            const shouldOpenEditor = product.slug === saveSlug || product.slug === deleteSlug;

            return (
            <details
              key={product.slug}
              open={shouldOpenEditor}
              className="group border border-neutral-200 bg-white"
            >
              <summary className="grid cursor-pointer list-none gap-3 p-4 transition-colors hover:bg-neutral-50 md:grid-cols-[72px_1fr_auto] [&::-webkit-details-marker]:hidden">
                <div className="h-20 w-16 overflow-hidden border border-neutral-200 bg-neutral-100">
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.12em] text-neutral-400">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="space-y-1">
                    <h3 className="truncate text-sm font-semibold tracking-tight">{product.title}</h3>
                    <p className="truncate text-xs text-neutral-500">
                      <code>{product.slug}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-neutral-600">
                    <span className="border border-neutral-200 px-2 py-1">{categoryLabel}</span>
                    <span className="border border-neutral-200 px-2 py-1">${formatPriceInput(product.priceCents)}</span>
                    <span className="border border-neutral-200 px-2 py-1">Stock {stock}</span>
                    {holdSummary.reservedStock > 0 ? (
                      <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
                        {holdSummary.reservedStock} held
                      </span>
                    ) : null}
                    <span className="border border-neutral-200 px-2 py-1">
                      {product.images.length} image{product.images.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2 md:min-w-[190px] md:justify-end">
                  <span
                    className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadge.className}`}
                  >
                    {statusBadge.label}
                  </span>
                  <span className="inline-flex items-center border border-neutral-300 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-700 group-open:hidden">
                    Open Editor
                  </span>
                  <span className="hidden items-center border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white group-open:inline-flex">
                    Editing
                  </span>
                </div>
              </summary>
              <div className="border-t border-neutral-200 p-6 space-y-4">
              <p className="text-xs text-neutral-500">
                Full editor for <span className="font-semibold text-neutral-700">{product.title}</span>.
              </p>
              <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
                <input type="hidden" name="originalSlug" value={product.slug} />
                <input type="hidden" name="returnStatusFilter" value={activeFilter} />
                <input type="hidden" name="returnCategoryFilter" value={activeCategory} />
                <input type="hidden" name="returnQuery" value={searchQuery} />
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Slug{slugLocked ? " (locked while live)" : ""}
                  </span>
                  <input
                    name="slug"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={80}
                    title="Use lowercase letters, numbers, and single hyphens only."
                    className={`h-10 border px-3 ${
                      slugLocked
                        ? "border-neutral-200 bg-neutral-50 text-neutral-500"
                        : "border-neutral-300"
                    }`}
                    defaultValue={product.slug}
                    readOnly={slugLocked}
                  />
                  <p className="text-[11px] text-neutral-500">
                    {slugLocked
                      ? "This listing is live, so the URL slug is locked. Hide or archive it first if you need to rename the slug."
                      : "Slug controls the product URL. Only rename hidden or archived listings."}
                  </p>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Title</span>
                  <input
                    name="title"
                    required
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={product.title}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Subtitle</span>
                  <input
                    name="subtitle"
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={product.subtitle}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Category</span>
                  <select
                    name="category"
                    defaultValue={product.category || ""}
                    className="h-10 border border-neutral-300 bg-white px-3"
                  >
                    <option value="">Uncategorized</option>
                    {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Description</span>
                  <textarea
                    name="description"
                    rows={3}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.description}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Price (USD)</span>
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={formatPriceInput(product.priceCents)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Stock</span>
                    <input
                      name="stock"
                      type="number"
                      min="0"
                      step="1"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={stock}
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Status</span>
                    <select
                      name="status"
                      defaultValue={getProductStatus(product)}
                      className="h-10 border border-neutral-300 bg-white px-3"
                    >
                      <option value="live">Live</option>
                      <option value="archived">Archived</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Automation</span>
                    <span className="flex h-10 items-center gap-2 border border-neutral-300 px-3 text-xs uppercase tracking-[0.12em] text-neutral-500">
                      <input
                        name="autoArchiveOnZero"
                        type="checkbox"
                        defaultChecked={product.autoArchiveOnZero}
                      />
                      Auto-archive at zero stock
                    </span>
                  </label>
                </div>
                <p className="text-xs text-neutral-500">
                  Keep auto-archive off for a manual sold-out state. Move to Archived whenever you want the piece to
                  live in the archive instead. When editing manually, set Status to Live after restocking if you want it
                  purchasable again.
                </p>
                <ImageUploadField
                  name="images"
                  defaultValue={product.images.join("\n")}
                  ownerType="product"
                  ownerId={product.slug}
                />
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Materials</span>
                  <textarea
                    name="materials"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.materials}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Dimensions</span>
                  <textarea
                    name="dimensions"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.dimensions}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Care</span>
                  <textarea
                    name="care"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.care}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Shipping & Returns</span>
                  <textarea
                    name="shippingReturns"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.shippingReturns}
                  />
                </label>
                <button className="h-11 border border-neutral-300 font-semibold hover:bg-neutral-50">
                  Update Product
                </button>
              </form>
              <form action="/api/admin/products/delete" method="POST" className="border-t border-neutral-200 pt-4 grid gap-3 text-sm">
                <input type="hidden" name="slug" value={product.slug} />
                <input type="hidden" name="returnStatusFilter" value={activeFilter} />
                <input type="hidden" name="returnCategoryFilter" value={activeCategory} />
                <input type="hidden" name="returnQuery" value={searchQuery} />
                <div className="space-y-1">
                  <h3 className="text-xs uppercase tracking-[0.12em] text-red-700">Delete Listing</h3>
                  <p className="text-xs text-neutral-600">
                    {deleteGuidance}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Product page URLs stop resolving once a listing is deleted.
                  </p>
                </div>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Confirm Slug</span>
                  <input
                    name="confirmSlug"
                    className="h-10 border border-neutral-300 px-3"
                    placeholder={product.slug}
                    required
                    disabled={deleteBlocked}
                  />
                </label>
                <button
                  className="h-11 border border-red-300 text-red-700 font-semibold hover:bg-red-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 disabled:hover:bg-transparent"
                  disabled={deleteBlocked}
                >
                  Delete Listing
                </button>
              </form>
              </div>
            </details>
            );
          })
        )}
      </section>
    </main>
  );
}
