import { getShopItems } from "@/lib/store";
import { getAvailableStockForSlugs } from "@/lib/inventory";
import { getSiteVisual } from "@/lib/site-visuals";
import AddToCartButton from "@/components/AddToCartButton";
import SiteVisualPlacement from "@/components/SiteVisualPlacement";
import type { Product, ProductCategory } from "@/lib/store";

export const metadata = { title: "Shop | LAEM Archive" };
export const dynamic = "force-dynamic";

type ShopPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

type CategoryFilter = "all" | ProductCategory;
type AvailabilityFilter = "all" | "in-stock" | "sold-out";

type ShopCategoryOption = {
  value: CategoryFilter;
  label: string;
};

type ShopAvailabilityOption = {
  value: AvailabilityFilter;
  label: string;
};

const CATEGORY_OPTIONS: ShopCategoryOption[] = [
  { value: "all", label: "All" },
  { value: "clothing", label: "Clothing" },
  { value: "accessories", label: "Accessories" },
  { value: "jewelry", label: "Jewelry" }
];

const AVAILABILITY_OPTIONS: ShopAvailabilityOption[] = [
  { value: "all", label: "All" },
  { value: "in-stock", label: "In stock" },
  { value: "sold-out", label: "Sold out" }
];

function money(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function getFirstSearchParam(value: string | string[] | undefined) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return "";
}

function parseCategoryFilter(value: string | string[] | undefined): CategoryFilter {
  const raw = getFirstSearchParam(value);
  if (raw === "clothing" || raw === "accessories" || raw === "jewelry") {
    return raw;
  }
  return "all";
}

function parseAvailabilityFilter(value: string | string[] | undefined): AvailabilityFilter {
  const raw = getFirstSearchParam(value);
  return raw === "in-stock" || raw === "sold-out" ? raw : "all";
}

function inferProductCategory(product: Product): ProductCategory | null {
  const raw = `${product.title} ${product.subtitle} ${product.description} ${product.materials}`.toLowerCase();

  if (
    /\b(ring|earring|earrings|necklace|bracelet|pendant|chain|jewelry|jewellery|sterling|silver|gold)\b/.test(raw)
  ) {
    return "jewelry";
  }
  if (
    /\b(bag|belt|scarf|hat|cap|wallet|sunglasses|glasses|accessory|accessories|keychain)\b/.test(raw)
  ) {
    return "accessories";
  }
  if (
    /\b(shirt|tee|t-shirt|hoodie|jacket|coat|dress|skirt|pants|trousers|jeans|knit|sweater|cardigan|top)\b/.test(raw)
  ) {
    return "clothing";
  }
  return null;
}

function getProductCategory(product: Product): ProductCategory | null {
  if (product.category === "clothing" || product.category === "accessories" || product.category === "jewelry") {
    return product.category;
  }
  return inferProductCategory(product);
}

function buildShopHref(category: CategoryFilter, availability: AvailabilityFilter) {
  const params = new URLSearchParams();
  if (category !== "all") {
    params.set("category", category);
  }
  if (availability !== "all") {
    params.set("availability", availability);
  }
  const query = params.toString();
  return query ? `/shop?${query}` : "/shop";
}

function buildCategoryHref(category: CategoryFilter, availability: AvailabilityFilter) {
  if (category === "all") {
    return "/shop";
  }
  return buildShopHref(category, availability);
}

function filterActiveClass(active: boolean) {
  if (active) {
    return "border-neutral-900 bg-neutral-900 text-white";
  }
  return "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const [items, shopBanner] = await Promise.all([
    getShopItems(),
    getSiteVisual("shop.banner")
  ]);
  const activeCategory = parseCategoryFilter(searchParams?.category);
  const activeFilter = parseAvailabilityFilter(searchParams?.availability);
  let availableStockBySlug: Record<string, number> = {};

  if (items.length > 0) {
    availableStockBySlug = await getAvailableStockForSlugs(items.map((item) => item.slug));
  }

  let visibleItems = items;
  if (activeCategory !== "all") {
    visibleItems = visibleItems.filter((item) => getProductCategory(item) === activeCategory);
  }
  if (activeFilter === "in-stock") {
    visibleItems = visibleItems.filter((item) => (availableStockBySlug[item.slug] || 0) > 0);
  }
  if (activeFilter === "sold-out") {
    visibleItems = visibleItems.filter((item) => (availableStockBySlug[item.slug] || 0) <= 0);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg md:text-xl font-semibold tracking-tight">Shop</h1>
        <p className="text-sm text-neutral-600">Current availability.</p>
      </header>

      <SiteVisualPlacement visual={shopBanner} variant="banner" />

      <section className="space-y-3 border border-neutral-200 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Category</span>
          {CATEGORY_OPTIONS.map((option) => (
            <a
              key={option.value}
              href={buildCategoryHref(option.value, activeFilter)}
              className={`inline-flex h-8 items-center border px-3 text-[11px] font-semibold uppercase tracking-[0.1em] no-underline ${filterActiveClass(
                activeCategory === option.value
              )}`}
            >
              {option.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Availability</span>
          {AVAILABILITY_OPTIONS.map((option) => (
            <a
              key={option.value}
              href={buildShopHref(activeCategory, option.value)}
              className={`inline-flex h-8 items-center border px-3 text-[11px] font-semibold uppercase tracking-[0.1em] no-underline ${filterActiveClass(
                activeFilter === option.value
              )}`}
            >
              {option.label}
            </a>
          ))}
        </div>
      </section>

      {visibleItems.length === 0 ? (
        <section className="border border-neutral-200 p-6 text-sm text-neutral-600">
          No products match this filter yet.
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {visibleItems.map((item) => {
            const primaryImage = item.images[0] || "/placeholder-product.svg";
            const availableStock = availableStockBySlug[item.slug] || 0;
            return (
            <article key={item.slug} className="group block no-underline space-y-3">
              <a href={`/products/${item.slug}`} className="block no-underline">
                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                  <img
                    src={primaryImage}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                  <div className="absolute left-2 top-2">
                    <span className="inline-flex items-center border border-neutral-200 bg-white/90 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-700">
                      {availableStock > 0 ? `${availableStock} available` : "Sold out"}
                    </span>
                  </div>
                </div>
              </a>

              <div className="space-y-2">
                <a href={`/products/${item.slug}`} className="block no-underline">
                  <h3 className="text-sm font-medium leading-snug text-neutral-900">{item.title}</h3>
                  <p className="text-xs text-neutral-600">
                    {item.description || item.subtitle}
                  </p>
                  <p className="text-xs text-neutral-600">
                    <span className="uppercase tracking-[0.12em] text-[10px] text-neutral-500">Price</span>{" "}
                    <span className="font-medium text-neutral-700">{money(item.priceCents)}</span>
                  </p>
                </a>
                <AddToCartButton
                  slug={item.slug}
                  title={item.title}
                  priceCents={item.priceCents}
                  image={primaryImage}
                  stock={availableStock}
                  unavailableLabel="Sold out"
                />
              </div>
            </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
