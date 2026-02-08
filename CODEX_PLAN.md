# LAEM Archive — Codex Build Plan

This repo is a prototype. The goal is to evolve it into a low-inventory, drop-based storefront:
- Next.js App Router on Vercel
- Vercel KV for products/stock/orders
- Vercel Blob for image storage
- Stripe Checkout for purchases (quantity-limited)
- Resend for correspondence emails (Order received / Shipped)

## Guiding constraints
- Keep the "archive / museum" presentation even for buyable items.
- Minimal UI, high whitespace, factual language.
- Archive must render even if Stripe is down.
- Stripe handles payment receipts. Resend handles calm correspondence.

---

## Phase 0 — Local dev sanity (today)
1. `npm i`
2. `npm run dev`
3. Verify routes:
   - /shop
   - /archive
   - /products/silver-band-01
   - /about
4. Verify the header is sticky and reads "LAEM Archive".

Deliverable: local build runs and `npm run build` passes.

---

## Phase 1 — Data model in KV (replace lib/store.ts)
### KV keys (proposed)
- `product:{slug}` -> JSON product record
- `products:index` -> list of slugs (or a set)
- `stock:{slug}` -> integer (single source of truth)
- `order:{sessionId}` -> JSON order record
- `orders:index` -> list of session IDs

### Product fields
- `slug`, `title`, `subtitle`, `priceCents`, `currency`
- `published`, `archived`
- `images[]` (Blob URLs)
- `materials`, `dimensions`, `care`, `shippingReturns`
- optional: `objectId`, `year`, `finish`, `runSize`

Deliverable: /shop and /archive load from KV with graceful empty states.

---

## Phase 2 — Stripe Checkout
### Requirements
- Create a Checkout Session server-side.
- Attach `metadata: { slug }`.
- Enforce quantity limit (max = KV stock).
- Webhook on `checkout.session.completed`:
  - verify signature
  - decrement KV stock
  - write `order:{sessionId}`
  - if stock hits 0, item should appear in /archive as Sold out

Deliverable: successful test purchase decrements stock and shows Sold out state.

---

## Phase 3 — Resend emails
### Emails
- Order received: sent after webhook confirms paid
- Shipped: triggered from admin when shipping data is added

Deliverable: emails sent via Resend; no duplication of Stripe receipts.

---

## Phase 4 — Admin UI (publish → sell → archive)
Admin pages:
- /admin/products (create/edit/publish/archive)
- /admin/orders (list + mark shipped, store tracking)

Deliverable: non-technical interface for drops.

---

## Phase 5 — Hardening
- Idempotency for webhook + emails
- Oversell protection (atomic stock decrement)
- Basic rate limiting for admin endpoints
- Domain + sender verification for Resend
