"use client";

import { useState } from "react";

import { useCart } from "@/lib/cart";

type Props = {
  slug: string;
  title: string;
  priceCents: number;
  image: string;
  stock: number;
  unavailable: boolean;
};

function clampQuantity(value: number, stock: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(Math.floor(value), Math.max(1, Math.floor(stock || 1))));
}

export default function ProductActions({ slug, title, priceCents, image, stock, unavailable }: Props) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  function updateQuantity(next: number) {
    setQuantity(clampQuantity(next, stock));
  }

  function handleAddToCart() {
    if (unavailable) {
      return;
    }

    addItem(
      {
        slug,
        title,
        priceCents,
        image,
        stock
      },
      quantity
    );
    setStatus("Added to cart.");
    setTimeout(() => setStatus(null), 1600);
  }

  async function handleBuyNow() {
    if (unavailable) {
      return;
    }

    setBuying(true);
    setStatus(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ slug, quantity }]
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
        setStatus(payload?.error || "Unable to start checkout.");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setStatus("Unable to start checkout.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Quantity</span>
        <div className="inline-flex items-center border border-neutral-300">
          <button
            type="button"
            className="h-10 w-10 text-sm font-semibold border-r border-neutral-300"
            onClick={() => updateQuantity(quantity - 1)}
            disabled={unavailable}
            aria-label="Decrease quantity"
          >
            -
          </button>
          <input
            type="number"
            min={1}
            max={Math.max(1, stock)}
            value={quantity}
            onChange={(event) => updateQuantity(Number(event.target.value))}
            className="h-10 w-16 text-center text-sm"
            disabled={unavailable}
          />
          <button
            type="button"
            className="h-10 w-10 text-sm font-semibold border-l border-neutral-300"
            onClick={() => updateQuantity(quantity + 1)}
            disabled={unavailable}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <span className="text-xs text-neutral-500">Max {Math.max(1, stock)}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={unavailable}
          className="h-11 border border-neutral-300 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
        >
          {unavailable ? "Unavailable" : "Add to Cart"}
        </button>
        <button
          type="button"
          onClick={handleBuyNow}
          disabled={unavailable || buying}
          className="h-11 bg-silver text-silver-text border border-silver-border text-sm font-semibold hover:bg-silver-hover active:bg-silver-active disabled:bg-silver-disabled disabled:text-neutral-500 disabled:cursor-not-allowed"
        >
          {buying ? "Redirecting..." : "Buy Now"}
        </button>
      </div>

      {status ? <p className="text-xs text-neutral-600">{status}</p> : null}
    </div>
  );
}
