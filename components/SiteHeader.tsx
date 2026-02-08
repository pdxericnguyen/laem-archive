export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <a href="/" className="text-sm font-semibold tracking-tight no-underline">
          LAEM Archive
        </a>

        <nav className="flex items-center gap-6 text-sm">
          <a href="/shop" className="hover:opacity-70 no-underline">Shop</a>
          <a href="/archive" className="hover:opacity-70 no-underline">Archive</a>
          <a href="/about" className="hover:opacity-70 no-underline">About</a>
        </nav>
      </div>
    </header>
  );
}
