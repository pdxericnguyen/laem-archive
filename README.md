# LAEM Archive (Prototype)

A runnable Next.js + Tailwind prototype for LAEM Archive.

## Run
```bash
npm install
npm run env:audit
npm run dev
```

## Environment
Set these environment variables before running the app:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_TERMINAL_LOCATION_ID (optional, useful for internet reader discovery)
- POS_APP_TOKEN (recommended for staff POS login)
- POS_SESSION_SECRET (recommended for signed POS staff sessions)
- POS_SESSION_TTL_SECONDS (optional, default `43200`)
- SITE_URL
- CHECKOUT_ALLOWED_ORIGINS (optional, comma-separated extra storefront origins, e.g. `https://www.laemarchive.com,https://laemarchive.com`)
- STRIPE_SHIPPING_ALLOWED_COUNTRIES (optional, default `US`, comma-separated ISO country codes)
- POS_CURRENCY (optional, default `usd`)
- UPSTASH_REDIS_REST_URL or KV_REST_API_URL
- UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN
- RESEND_API_KEY
- EMAIL_FROM
- RESEND_FROM
- ADMIN_TOKEN
- ADMIN_SESSION_SECRET
- BLOB_READ_WRITE_TOKEN
- AUTO_PRINT_PACKING_SLIP (optional, default `false`, auto-print checkout packing slips)
- AUTO_PRINT_PACKING_SLIP_POS (optional, default `false`, auto-print iPad POS packing slips)
- INVENTORY_ALERT_EMAIL (optional)
- ADMIN_ALERT_EMAIL (optional fallback)
- LOW_STOCK_THRESHOLD (optional, default `2`)
- RATE_LIMIT_LOGIN_MAX (optional, default `10`)
- RATE_LIMIT_LOGIN_WINDOW_SECONDS (optional, default `300`)
- RATE_LIMIT_POS_LOGIN_MAX (optional, default `10`)
- RATE_LIMIT_POS_LOGIN_WINDOW_SECONDS (optional, default `300`)
- RATE_LIMIT_CHECKOUT_MAX (optional, default `20`)
- RATE_LIMIT_CHECKOUT_WINDOW_SECONDS (optional, default `60`)

The app uses `@upstash/redis` directly. If your Vercel integration injects legacy `KV_REST_*` variables, those aliases are still accepted.

## Admin Auth
- Visit `/admin/login` and sign in with `ADMIN_TOKEN`.
- Admin session is stored in an `httpOnly` cookie.

## Admin Product Management
- Visit `/admin/products` to add and edit products without code changes.
- Product forms include: title, subtitle, description, pricing, stock, publish/archive state, auto-archive at zero stock toggle, and detail copy.
- Use `Upload to Blob` in the image field to upload local images and append URLs automatically.
- Use `Bulk Stock` mode for rapid inventory updates.
- Use `Apply To Selected` + `Save Selected` to update only selected product rows.

## Admin Fulfillment
- Visit `/admin/orders` for order fulfillment.
- Filter by status and date range, then page through results.
- Order cards now show the captured shipping address from Stripe Checkout when available.
- Mark paid orders shipped with inline success/error feedback.
- `stock_conflict` orders are non-shippable until resolved via the admin `Mark conflict resolved` action.

## Cart + Checkout
- Storefront supports multi-item cart at `/cart`.
- Product and shop pages support `Add to Cart`.
- `/api/checkout` accepts multi-item JSON payloads (`items: [{ slug, quantity }]`) for cart checkout.
- Stripe Checkout collects shipping and billing address details for web orders and stores the shipping address on the order record.
- Stripe webhook reads cart metadata and decrements stock per item atomically.

## LAEM POS API
- `POST /api/pos/auth/login` returns a signed staff session token for the LAEM POS app.
- `GET /api/pos/products` returns published catalog items for an authenticated in-person POS client.
- `POST /api/terminal/connection-token` mints Stripe Terminal connection tokens for an authenticated POS session.
- `POST /api/terminal/create-payment-intent` creates a `card_present` PaymentIntent from server-side product pricing for an authenticated POS session.
- `POST /api/terminal/cancel-payment-intent` cancels an abandoned Terminal PaymentIntent and releases its inventory hold.
- Stripe webhook now finalizes both Checkout sessions and LAEM Terminal PaymentIntents into the same inventory/order pipeline.
- Emergency event-day fallback workflow lives in `docs/laem-pos-emergency-sales-sop.md`.

## Pages
- /shop
- /archive
- /about
- /contact
- /products/silver-band-01
