import { getArchiveItems } from "@/lib/store";

export const metadata = { title: "Archive | LAEM Archive" };
export const dynamic = "force-dynamic";

function money(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

export default async function ArchivePage() {
  const items = await getArchiveItems();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Archive</h1>
        <p className="text-sm text-neutral-600">Previous objects. No longer available.</p>
      </header>

      {items.length === 0 ? (
        <section className="border border-neutral-200 p-6 text-sm text-neutral-600">
          No archived products yet.
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <a key={item.slug} href={`/products/${item.slug}`} className="group block no-underline">
              <div className="space-y-3">
                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                  <img
                    src={item.images[0]}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                  <div className="absolute left-2 top-2">
                    <span className="inline-flex items-center border border-neutral-200 bg-white/90 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-700">
                      {item.archived ? "Archived" : "Sold out"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-medium leading-snug text-neutral-900">{item.title}</h3>
                  <p className="text-xs text-neutral-600">
                    {item.description || item.subtitle}
                  </p>
                  <p className="text-xs text-neutral-600">
                    <span className="uppercase tracking-[0.12em] text-[10px] text-neutral-500">Price</span>{" "}
                    <span className="font-medium text-neutral-700">{money(item.priceCents)}</span>
                  </p>
                </div>
              </div>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
