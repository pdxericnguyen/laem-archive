"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useCart } from "@/lib/cart";

type CartRefreshWarning = {
  slug: string;
  kind: "price_changed" | "quantity_reduced" | "unavailable";
  message: string;
};

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CartClient() {
  const { items, hydrated, subtotalCents, replaceItems, setQuantity, removeItem, clear } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshWarnings, setRefreshWarnings] = useState<CartRefreshWarning[]>([]);
  const refreshedRef = useRef(false);
  const skipRefreshRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      skipRefreshRef.current = true;
      clear();
      setRefreshWarnings([]);
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

      void (async () => {
        try {
          await fetch("/api/checkout/release", { method: "POST" });
        } catch {
          // best effort
        } finally {
          refreshedRef.current = false;
          setRefreshTick((value) => value + 1);
        }
      })();
    }
  }, [clear]);

  useEffect(() => {
    if (items.length === 0) {
      setRefreshWarnings([]);
      return;
    }

    const activeSlugs = new Set(items.map((item) => item.slug));
    setRefreshWarnings((prev) => prev.filter((warning) => activeSlugs.has(warning.slug)));
  }, [items]);

  useEffect(() => {
    if (!hydrated || skipRefreshRef.current) {
      return;
    }

    if (items.length === 0) {
      setRefreshWarnings([]);
      return;
    }

    if (refreshedRef.current) {
      return;
    }

    refreshedRef.current = true;

    let cancelled = false;

    async function refreshCart() {
      setRefreshing(true);
      setError(null);
      try {
        const response = await fetch("/api/cart/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) {
          if (!cancelled) {
            setError("Unable to refresh cart against live inventory.");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        replaceItems(payload.items);
        setRefreshWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
      } catch {
        if (!cancelled) {
          setError("Unable to refresh cart against live inventory.");
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
        }
      }
    }

    void refreshCart();

    return () => {
      cancelled = true;
    };
  }, [hydrated, items, replaceItems, refreshTick]);

  const warningMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const warning of refreshWarnings) {
      const messages = map.get(warning.slug) || [];
      messages.push(warning.message);
      map.set(warning.slug, messages);
    }
    return map;
  }, [refreshWarnings]);

  const canCheckout = useMemo(() => {
    return !refreshing && items.length > 0 && items.every((item) => item.stock > 0 && item.quantity > 0);
  }, [items, refreshing]);

  async function checkout() {
    if (!canCheckout) {
      setError("Some cart items changed or are unavailable. Review the warnings below before checkout.");
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

      {refreshing ? (
        <section className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          Checking live pricing and availability...
        </section>
      ) : null}

      {refreshWarnings.length > 0 ? (
        <section className="border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
          <h2 className="text-sm font-semibold text-amber-900">Cart updated to match live inventory</h2>
          <ul className="space-y-1 text-xs text-amber-900">
            {refreshWarnings.map((warning, index) => (
              <li key={`${warning.slug}-${warning.kind}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

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
            {items.map((item) => {
              const itemWarnings = warningMap.get(item.slug) || [];
              const unavailable = item.stock <= 0;

              return (
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
                      <div className="text-xs text-neutral-600">{money(item.priceCents)} each</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-neutral-600">Qty</label>
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, item.stock)}
                          value={item.quantity}
                          onChange={(event) => setQuantity(item.slug, Number(event.target.value))}
                          disabled={unavailable}
                          className="h-9 w-20 appearance-none border border-neutral-300 px-0 text-center text-sm leading-none disabled:bg-neutral-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                      {unavailable ? (
                        <p className="text-xs text-red-600">Currently unavailable. Remove this item to continue to checkout.</p>
                      ) : (
                        <p className="text-xs text-neutral-600">Available now: {item.stock}</p>
                      )}
                      {itemWarnings.length > 0 ? (
                        <ul className="space-y-1 text-xs text-amber-900">
                          {itemWarnings.map((message, index) => (
                            <li key={`${item.slug}-warning-${index}`}>{message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
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
              {refreshing ? "Checking cart..." : checkingOut ? "Redirecting..." : "Checkout"}
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
