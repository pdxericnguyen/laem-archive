"use client";

import { useState } from "react";

import { useCart } from "@/lib/cart";

export default function SiteHeader() {
  const { itemCount } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <a
          href="/"
          className="text-base md:text-lg font-semibold tracking-tight no-underline"
          onClick={() => setMobileOpen(false)}
        >
          LAEM Archive
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="/shop" className="hover:opacity-70 no-underline">Shop</a>
          <a href="/archive" className="hover:opacity-70 no-underline">Archive</a>
          <a href="/about" className="hover:opacity-70 no-underline">About</a>
          <a href="/contact" className="hover:opacity-70 no-underline">Contact</a>
          <a href="/cart" className="relative hover:opacity-70 no-underline">
            Cart
            <span className="ml-1 text-xs text-neutral-500">({itemCount})</span>
          </a>
        </nav>

        <div className="md:hidden flex items-center gap-2">
          <a
            href="/cart"
            className="relative inline-flex h-9 items-center border border-neutral-300 px-3 text-xs font-semibold no-underline"
            onClick={() => setMobileOpen(false)}
          >
            Cart
            {itemCount > 0 ? (
              <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] text-white">
                {itemCount}
              </span>
            ) : null}
          </a>
          <button
            type="button"
            className="inline-flex h-9 items-center border border-neutral-300 px-3 text-xs font-semibold"
            onClick={() => setMobileOpen((value) => !value)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-neutral-200 bg-white md:hidden">
          <nav className="mx-auto max-w-6xl px-4 py-3 grid gap-2 text-sm">
            <a
              href="/shop"
              className="h-10 inline-flex items-center no-underline hover:opacity-70"
              onClick={() => setMobileOpen(false)}
            >
              Shop
            </a>
            <a
              href="/archive"
              className="h-10 inline-flex items-center no-underline hover:opacity-70"
              onClick={() => setMobileOpen(false)}
            >
              Archive
            </a>
            <a
              href="/about"
              className="h-10 inline-flex items-center no-underline hover:opacity-70"
              onClick={() => setMobileOpen(false)}
            >
              About
            </a>
            <a
              href="/contact"
              className="h-10 inline-flex items-center no-underline hover:opacity-70"
              onClick={() => setMobileOpen(false)}
            >
              Contact
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
