import { summarizeReservationHoldsForSlugs, type ReservationHoldSummary } from "@/lib/inventory";
import { hasKvEnv, kv } from "@/lib/kv";
import type { Product } from "@/lib/store";
import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import UnsavedChangesGuard from "../unsaved-changes-guard";
import BulkStockEditor from "./stock-bulk";
import ImageUploadField from "./image-upload-field";

export const dynamic = "force-dynamic";

type AdminProductsPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

type ProductStatus = "live" | "archived" | "hidden";
type ProductFilterStatus = "all" | ProductStatus | "sold-out";

type ProductStatusBadge = {
  label: string;
  className: string;
};

type FilterOption = {
  value: ProductFilterStatus;
  label: string;
};

type DeleteErrorCode = "live" | "reserved";
type SaveErrorCode = "slug_locked" | "invalid_live_price";

type ProductRow = {
  product: Product;
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

function getProductFilterStatus(product: Product): Exclude<ProductFilterStatus, "all"> {
  const status = getProductStatus(product);
  if (status === "hidden" || status === "archived") {
    return status;
  }
  return product.stock <= 0 ? "sold-out" : "live";
}

function getProductStatusBadge(product: Product): ProductStatusBadge {
  const status = getProductFilterStatus(product);

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

  if (product.stock <= 0) {
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

function parseDeleteErrorCode(value: string | string[] | undefined): DeleteErrorCode | null {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "live" || raw === "reserved" ? raw : null;
}

function parseSaveErrorCode(value: string | string[] | undefined): SaveErrorCode | null {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  return raw === "slug_locked" || raw === "invalid_live_price" ? raw : null;
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

function buildFilterHref(
  filter: ProductFilterStatus,
  deletedSlug: string | null,
  deleteError: DeleteErrorCode | null,
  deleteSlug: string | null,
  deleteReservedStock: number | null,
  deleteActiveCheckoutCount: number | null,
  deleteLastExpiresAt: number | null,
  saveError: SaveErrorCode | null,
  saveSlug: string | null
) {
  const params = new URLSearchParams();
  if (filter !== "all") {
    params.set("status", filter);
  }
  if (deletedSlug) {
    params.set("deleted", deletedSlug);
  }
  if (deleteError && deleteSlug) {
    params.set("deleteError", deleteError);
    params.set("deleteSlug", deleteSlug);
    if (deleteReservedStock) {
      params.set("deleteReservedStock", String(deleteReservedStock));
    }
    if (deleteActiveCheckoutCount) {
      params.set("deleteActiveCheckoutCount", String(deleteActiveCheckoutCount));
    }
    if (deleteLastExpiresAt) {
      params.set("deleteLastExpiresAt", String(deleteLastExpiresAt));
    }
  }
  if (saveError && saveSlug) {
    params.set("saveError", saveError);
    params.set("saveSlug", saveSlug);
  }
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
  const holdSummariesBySlug = await summarizeReservationHoldsForSlugs(products.map((product) => product.slug));
  const productRows: ProductRow[] = products.map((product) => ({
    product,
    holdSummary: holdSummariesBySlug[product.slug] || {
      reservedStock: 0,
      activeCheckoutCount: 0
    }
  }));
  const nowMs = Date.now();
  const deletedSlug = typeof searchParams?.deleted === "string" ? searchParams.deleted : null;
  const deleteError = parseDeleteErrorCode(searchParams?.deleteError);
  const deleteSlug = typeof searchParams?.deleteSlug === "string" ? searchParams.deleteSlug : null;
  const deleteReservedStock = parseOptionalPositiveInt(searchParams?.deleteReservedStock);
  const deleteActiveCheckoutCount = parseOptionalPositiveInt(searchParams?.deleteActiveCheckoutCount);
  const deleteLastExpiresAt = parseOptionalPositiveInt(searchParams?.deleteLastExpiresAt);
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
  const saveError = parseSaveErrorCode(searchParams?.saveError);
  const saveSlug = typeof searchParams?.saveSlug === "string" ? searchParams.saveSlug : null;
  const saveErrorMessage = getSaveErrorMessage(saveError, saveSlug);
  const activeFilter = parseFilterStatus(searchParams?.status);
  const filterOptions: FilterOption[] = [
    { value: "all", label: "All" },
    { value: "live", label: "Live" },
    { value: "sold-out", label: "Sold out" },
    { value: "archived", label: "Archived" },
    { value: "hidden", label: "Hidden" }
  ];
  const filterCounts = {
    all: productRows.length,
    live: productRows.filter(({ product }) => getProductFilterStatus(product) === "live").length,
    "sold-out": productRows.filter(({ product }) => getProductFilterStatus(product) === "sold-out").length,
    archived: productRows.filter(({ product }) => getProductFilterStatus(product) === "archived").length,
    hidden: productRows.filter(({ product }) => getProductFilterStatus(product) === "hidden").length
  };
  const filteredRows =
    activeFilter === "all"
      ? productRows
      : productRows.filter(({ product }) => getProductFilterStatus(product) === activeFilter);
  const activeFilterLabel = filterOptions.find((option) => option.value === activeFilter)?.label || "All";

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

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const isActive = option.value === activeFilter;
            return (
              <a
                key={option.value}
                href={buildFilterHref(
                  option.value,
                  deletedSlug,
                  deleteError,
                  deleteSlug,
                  deleteReservedStock,
                  deleteActiveCheckoutCount,
                  deleteLastExpiresAt,
                  saveError,
                  saveSlug
                )}
                className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] no-underline transition-colors ${
                  isActive
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <span>{option.label}</span>
                <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${
                  isActive ? "bg-white/15 text-white" : "bg-neutral-100 text-neutral-600"
                }`}>
                  {filterCounts[option.value]}
                </span>
              </a>
            );
          })}
        </div>
        <p className="text-xs text-neutral-500">
          Showing <span className="font-semibold text-neutral-700">{activeFilterLabel}</span> products for faster admin review.
        </p>
      </section>

      <BulkStockEditor
        rows={filteredRows.map(({ product }) => ({
          slug: product.slug,
          title: product.title,
          stock: product.stock
        }))}
      />

      <section className="border border-neutral-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Add Product</h2>
        <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
          <input type="hidden" name="returnStatusFilter" value={activeFilter} />
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Slug</span>
            <input name="slug" required className="h-10 border border-neutral-300 px-3" />
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
          <ImageUploadField name="images" />
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
        <h2 className="text-sm font-semibold tracking-tight">Existing Products</h2>
        {filteredRows.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-600">
            {activeFilter === "all" ? "No products yet." : `No ${activeFilterLabel.toLowerCase()} products yet.`}
          </div>
        ) : (
          filteredRows.map(({ product, holdSummary }) => {
            const statusBadge = getProductStatusBadge(product);
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

            return (
            <div key={product.slug} className="border border-neutral-200 p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold tracking-tight">{product.title}</h3>
                  <p className="text-xs text-neutral-500">
                    <code>{product.slug}</code>
                  </p>
                </div>
                <span
                  className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadge.className}`}
                >
                  {statusBadge.label}
                </span>
              </div>
              <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
                <input type="hidden" name="originalSlug" value={product.slug} />
                <input type="hidden" name="returnStatusFilter" value={activeFilter} />
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Slug{slugLocked ? " (locked while live)" : ""}
                  </span>
                  <input
                    name="slug"
                    required
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
                      defaultValue={product.stock}
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
                <ImageUploadField name="images" defaultValue={product.images.join("\n")} />
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
            );
          })
        )}
      </section>
    </main>
  );
}
