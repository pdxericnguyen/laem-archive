# LAEM POS Emergency Sales SOP

Use this when the normal LAEM POS flow is interrupted by reader issues, network loss, or time pressure at an event.

## Normal path

Use the LAEM POS iPad/iPhone app with the Stripe Reader M2.

- Best result for inventory tracking
- Best result for order history
- Preferred whenever the reader and network are working

## Fallback order

Use the first option that works:

1. LAEM POS app + M2 while online
2. LAEM POS app + M2 with Stripe Terminal offline storage enabled
3. Direct Stripe charge, then manual stock update in LAEM admin

## Before the event

- Charge the iPad/iPhone and the M2
- Confirm the LAEM POS app can sign in
- Confirm at least one test product loads in the POS app
- Confirm the M2 connects in the app
- Confirm Stripe Terminal offline mode is enabled for the assigned Stripe Terminal Location
- Sign in to `/admin/login` on a phone or laptop so admin stock controls are easy to reach if needed

## If the internet drops but the M2 still works

Use the LAEM POS app first.

- Keep selling through the LAEM POS app
- Watch the reader status panel for queued offline payments
- Do not re-ring the same customer in Stripe Dashboard if the app already says the payment was stored
- Bring the device back online as soon as possible so Stripe can forward stored payments

## If the M2 fails or the POS app cannot complete checkout

You can still take payment directly in Stripe, but inventory will not auto-update.

Use this flow:

1. Charge the customer directly in Stripe
2. Write down what sold
3. Open `/admin/products`
4. Reduce stock manually for each sold product
5. If you sold several pieces, use the bulk stock editor to update multiple products faster

## Minimum sale log for manual fallback

For every direct Stripe fallback sale, record:

- time
- product slug or product title
- quantity
- amount charged
- Stripe payment reference

This can live in Notes, a shared sheet, or a paper log during the event. The goal is to make post-event stock reconciliation easy.

## After the event

Reconcile everything before the next sales window.

1. Check Stripe payments taken outside the LAEM POS app
2. Compare them against the manual sale log
3. Confirm stock counts in `/admin/products`
4. Confirm any offline-stored M2 payments have forwarded successfully
5. Resolve any stock mismatch immediately

## Important rule

Direct Stripe charges are an emergency fallback, not the preferred workflow.

They are safe for taking payment, but they do not carry LAEM POS cart metadata, so the LAEM inventory webhook cannot automatically decrement stock for those sales.
