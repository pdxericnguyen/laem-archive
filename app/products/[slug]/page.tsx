import { getProduct } from "@/lib/store";

export const metadata = { title: "Product | LAEM Archive" };

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await getProduct(params.slug);
  if (!product || !product.published) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-neutral-600">Not found.</p>
      </main>
    );
  }

  const isUnavailable = product.archived || product.stock <= 0;
  const description =
    product.description && product.description !== product.subtitle ? product.description : "";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 pb-24 md:pb-10">
      <div className="grid gap-10 md:grid-cols-2">
        <section className="space-y-3">
          <div className="relative aspect-[4/5] w-full overflow-hidden bg-neutral-100">
            <img
              src={product.images[0]}
              alt={product.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </section>

        <section className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{product.title}</h1>
            <p className="text-sm text-neutral-600">{product.subtitle}</p>
            {description ? <p className="text-sm text-neutral-700 whitespace-pre-line">{description}</p> : null}
          </header>

          <div className="space-y-3 border-y border-neutral-200 py-4">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <div className="uppercase tracking-[0.12em] text-neutral-500">Price</div>
                <div className="text-sm font-medium text-neutral-900">
                  ${Math.round(product.priceCents / 100)}
                </div>
              </div>
              <div className="space-y-1 text-right">
                <div className="uppercase tracking-[0.12em] text-neutral-500">Availability</div>
                <div className="text-sm font-medium text-neutral-900">
                  {product.archived ? "Archived" : product.stock > 0 ? `${product.stock} available` : "Unavailable"}
                </div>
              </div>
            </div>

            <form action="/api/checkout" method="POST">
              <input type="hidden" name="slug" value={product.slug} />
              <button
                disabled={isUnavailable}
                className="w-full h-12 bg-silver text-silver-text border border-silver-border text-sm font-semibold
                           hover:bg-silver-hover active:bg-silver-active
                           disabled:bg-silver-disabled disabled:text-neutral-500 disabled:cursor-not-allowed"
              >
                Purchase
              </button>
            </form>

            {product.stock <= 0 && !product.archived && (
              <div className="text-sm text-neutral-700">
                <p className="mb-2">This piece is currently unavailable.</p>
                <div className="flex gap-3">
                  <a className="h-11 px-4 inline-flex items-center justify-center border border-neutral-300 text-sm font-semibold no-underline hover:bg-neutral-50" href="/archive">
                    View archive
                  </a>
                  <a className="h-11 px-4 inline-flex items-center justify-center border border-neutral-300 text-sm font-semibold no-underline hover:bg-neutral-50" href="/contact">
                    Inquire
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="divide-y divide-neutral-200 border-y border-neutral-200">
            <details className="py-4" open>
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.12em] text-neutral-700">
                Materials
              </summary>
              <div className="pt-3 text-sm text-neutral-700 whitespace-pre-line">{product.materials}</div>
            </details>

            <details className="py-4">
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.12em] text-neutral-700">
                Dimensions
              </summary>
              <div className="pt-3 text-sm text-neutral-700 whitespace-pre-line">{product.dimensions}</div>
            </details>

            <details className="py-4">
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.12em] text-neutral-700">
                Care
              </summary>
              <div className="pt-3 text-sm text-neutral-700 whitespace-pre-line">{product.care}</div>
            </details>

            <details className="py-4">
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.12em] text-neutral-700">
                Shipping & Returns
              </summary>
              <div className="pt-3 text-sm text-neutral-700 whitespace-pre-line">{product.shippingReturns}</div>
            </details>
          </div>

          <p className="text-xs text-neutral-500">
            Hand-finished. Natural variation is expected. Silver will age with wear.
          </p>
        </section>
      </div>

      {!product.archived && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-neutral-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.12em] text-neutral-500">Price</div>
              <div className="text-sm font-semibold">${Math.round(product.priceCents / 100)}</div>
              <div className="text-[11px] text-neutral-600">
                {product.stock > 0 ? `${product.stock} available` : "Unavailable"}
              </div>
            </div>
            <form action="/api/checkout" method="POST" className="flex-1">
              <input type="hidden" name="slug" value={product.slug} />
              <button
                disabled={product.stock <= 0}
                className="w-full h-11 bg-silver text-silver-text border border-silver-border text-sm font-semibold
                           hover:bg-silver-hover active:bg-silver-active
                           disabled:bg-silver-disabled disabled:text-neutral-500 disabled:cursor-not-allowed"
              >
                Purchase
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
