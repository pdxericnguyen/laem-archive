export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-10 space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.12em] text-neutral-600">LAEM Archive</p>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Silver objects.</h1>
        <p className="text-sm text-neutral-700 max-w-2xl">
          Small runs. Hand-finished. Archive-forward presentation.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 text-sm">
        <a className="h-11 px-4 border border-neutral-300 inline-flex items-center justify-center no-underline hover:bg-neutral-50" href="/shop">
          Shop
        </a>
        <a className="h-11 px-4 border border-neutral-300 inline-flex items-center justify-center no-underline hover:bg-neutral-50" href="/archive">
          Archive
        </a>
        <a className="h-11 px-4 border border-neutral-300 inline-flex items-center justify-center no-underline hover:bg-neutral-50" href="/cart">
          Cart
        </a>
      </div>
    </main>
  );
}
