"use client";

import { useState } from "react";

import { useCart } from "@/lib/cart";

type Props = {
  slug: string;
  title: string;
  priceCents: number;
  image: string;
  stock: number;
  quantity?: number;
  className?: string;
  disabled?: boolean;
};

export default function AddToCartButton({
  slug,
  title,
  priceCents,
  image,
  stock,
  quantity = 1,
  className,
  disabled
}: Props) {
  const { addItem } = useCart();
  const [message, setMessage] = useState<string | null>(null);

  const unavailable = disabled || stock <= 0;

  function onClick() {
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
    setMessage("Added");
    setTimeout(() => setMessage(null), 1400);
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={unavailable}
        className={
          className ||
          "w-full h-10 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
        }
      >
        {unavailable ? "Unavailable" : "Add to Cart"}
      </button>
      {message ? <p className="text-[11px] text-neutral-600">{message}</p> : null}
    </div>
  );
}
