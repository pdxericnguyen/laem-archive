"use client";

import { useState } from "react";

import { useCart } from "@/lib/cart";

const SHOP_FILTER_LINKS = [
  { href: "/shop", label: "All products" },
  { href: "/shop?category=clothing", label: "Clothing" },
  { href: "/shop?category=accessories", label: "Accessories" },
  { href: "/shop?category=jewelry", label: "Jewelry" }
];

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

        <nav className="hidden md:flex items-center gap-5 text-sm">
          <div className="relative group">
            <a
              href="/shop"
              className="inline-flex items-center no-underline hover:opacity-70"
              aria-haspopup="menu"
            >
              Shop
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="ml-0.5 h-2.5 w-2.5 text-neutral-500 transition-transform duration-150 group-hover:rotate-180 group-focus-within:rotate-180"
              >
                <path
                  d="M5 7.5L10 12.5L15 7.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <div className="pointer-events-none absolute left-0 top-full z-50 w-52 translate-y-1 pt-3 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
              <div className="border border-neutral-200 bg-white p-1 shadow-lg">
                {SHOP_FILTER_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="flex h-9 items-center px-2 text-xs font-medium uppercase tracking-[0.08em] text-neutral-700 no-underline hover:bg-neutral-100"
                    role="menuitem"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
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
