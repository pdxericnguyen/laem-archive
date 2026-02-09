"use client";

import { useEffect, useMemo, useState } from "react";

import { useCart } from "@/lib/cart";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CartClient() {
  const { items, subtotalCents, setQuantity, removeItem, clear } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      clear();
      setNotice("Payment successful. Thank you.");
      params.delete("success");
      params.delete("session_id");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `/cart?${next}` : "/cart");
      return;
    }
    if (params.get("canceled") === "1") {
      setNotice("Checkout canceled.");
      params.delete("canceled");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `/cart?${next}` : "/cart");
    }
  }, [clear]);

  const canCheckout = useMemo(() => {
    return items.length > 0 && items.every((item) => item.stock > 0 && item.quantity > 0);
  }, [items]);

  async function checkout() {
    if (!canCheckout) {
      setError("Some cart items are unavailable.");
      return;
    }

    setCheckingOut(true);
    setError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({
            slug: item.slug,
            quantity: item.quantity
          }))
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
        setError(payload?.error || "Unable to start checkout.");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Unable to start checkout.");
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg md:text-xl font-semibold tracking-tight">Cart</h1>
        <p className="text-sm text-neutral-600">Review items before Stripe checkout.</p>
      </header>
      {notice ? <p className="text-sm text-neutral-700">{notice}</p> : null}

      {items.length === 0 ? (
        <section className="border border-neutral-200 p-6 space-y-3">
          <p className="text-sm text-neutral-700">Your cart is empty.</p>
          <a
            href="/shop"
            className="inline-flex h-10 items-center border border-neutral-300 px-4 text-sm font-semibold no-underline hover:bg-neutral-50"
          >
            Continue shopping
          </a>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="space-y-3">
            {items.map((item) => (
              <div key={item.slug} className="border border-neutral-200 p-3 md:p-4">
                <div className="grid grid-cols-[80px_1fr] gap-3 md:grid-cols-[120px_1fr] md:gap-4">
                  <a href={`/products/${item.slug}`} className="block aspect-[4/5] overflow-hidden bg-neutral-100">
                    <img src={item.image} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                  </a>

                  <div className="space-y-2 min-w-0">
                    <a
                      href={`/products/${item.slug}`}
                      className="block text-sm font-medium no-underline hover:opacity-70"
                    >
                      {item.title}
                    </a>
                    <div className="text-xs text-neutral-600">
                      {money(item.priceCents)} each
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-neutral-600">Qty</label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, item.stock)}
                        value={item.quantity}
                        onChange={(event) => setQuantity(item.slug, Number(event.target.value))}
                        className="h-9 w-20 border border-neutral-300 px-2 text-sm"
                      />
                      <button
                        type="button"
                        className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
                        onClick={() => removeItem(item.slug)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="text-xs text-neutral-600">
                      Subtotal: <span className="font-medium text-neutral-900">{money(item.priceCents * item.quantity)}</span>
                    </div>
                    {item.stock <= 0 ? (
                      <p className="text-xs text-red-600">Currently unavailable.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <aside className="border border-neutral-200 p-4 space-y-3 h-fit">
            <h2 className="text-sm font-semibold tracking-tight">Order Summary</h2>
            <div className="flex items-center justify-between text-sm">
              <span>Subtotal</span>
              <span className="font-semibold">{money(subtotalCents)}</span>
            </div>
            <p className="text-xs text-neutral-600">Taxes and shipping are calculated at Stripe checkout.</p>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <button
              type="button"
              onClick={checkout}
              disabled={checkingOut || !canCheckout}
              className="w-full h-11 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {checkingOut ? "Redirecting..." : "Checkout"}
            </button>
            <button
              type="button"
              onClick={clear}
              className="w-full h-10 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
            >
              Clear Cart
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}
