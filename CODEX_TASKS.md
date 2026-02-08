# Codex Tasks (copy/paste prompts)

These prompts are designed for Codex CLI or Codex web tasks.

## 1) Replace mock store with Vercel KV (read-only)
You are working in a Next.js App Router repo. Replace `lib/store.ts` mock data with Vercel KV reads.
- Add KV access using `@vercel/kv`.
- Implement:
  - `getShopItems()`
  - `getArchiveItems()`
  - `getProduct(slug)`
- Add empty-state UI if KV has no products.
- Keep current UI unchanged.
- Ensure `npm run build` passes.

## 2) Add Stripe Checkout (create session API)
Add `app/api/checkout/route.ts` that creates a Stripe Checkout Session.
- Use adjustable quantity with max based on `stock:{slug}` in KV.
- Attach session metadata: `{ slug }`.
- Redirect to Stripe checkout URL.
- Add env vars:
  - STRIPE_SECRET_KEY
  - SITE_URL
- Update Purchase button to POST to /api/checkout with slug.

## 3) Add Stripe webhook (stock decrement + order record)
Add `app/api/stripe/webhook/route.ts`.
- Verify webhook signature with STRIPE_WEBHOOK_SECRET.
- On `checkout.session.completed` with `payment_status=paid`:
  - list line items for quantity
  - decrement `stock:{slug}`
  - write `order:{sessionId}` record
  - append to `orders:index`
- Make it idempotent (do nothing if order already exists).

## 4) Add Resend emails
Add `lib/email.ts` and send:
- Order received (after webhook processes paid session)
- Shipped (from admin endpoint)

## 5) Admin orders page (ship)
Create `/admin/orders` UI that lists recent orders and includes a small form to add:
- carrier
- tracking number
- tracking URL
Calls `/api/admin/orders/ship` which stores shipping info and triggers Resend shipped email.
