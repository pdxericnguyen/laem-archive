"use client";

import { useEffect } from "react";

import { useCart } from "@/lib/cart";

type Props = {
  sessionId: string | null;
};

function formatReference(sessionId: string | null) {
  if (!sessionId) {
    return null;
  }
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return sessionId.slice(-12);
}

export default function SuccessClient({ sessionId }: Props) {
  const { clear } = useCart();

  useEffect(() => {
    clear();
  }, [clear]);

  const reference = formatReference(sessionId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <section className="border border-neutral-200 bg-white p-6 md:p-8 space-y-6">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Order Received</p>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Thank you for your order.</h1>
          <p className="max-w-2xl text-sm md:text-base text-neutral-700">
            Your payment was successful and your order has been recorded. If you entered an email at
            checkout, Stripe and LAEM will use it for confirmation and fulfillment updates.
          </p>
        </div>

        {reference ? (
          <div className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            Reference: <span className="font-mono text-xs text-neutral-900">{reference}</span>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm text-neutral-700">
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900">What happens next</h2>
            <p>Your piece is now in the order queue and inventory has been updated.</p>
            <p>Shipping details will appear once the order is marked shipped in admin.</p>
          </div>

          <div className="space-y-3">
            <a
              href="/shop"
              className="inline-flex h-11 w-full items-center justify-center border border-neutral-300 text-sm font-semibold no-underline hover:bg-neutral-50"
            >
              Continue Shopping
            </a>
            <a
              href="/archive"
              className="inline-flex h-11 w-full items-center justify-center border border-neutral-300 text-sm font-semibold no-underline hover:bg-neutral-50"
            >
              View Archive
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
