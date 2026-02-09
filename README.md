# LAEM Archive (Prototype)

A runnable Next.js + Tailwind prototype for LAEM Archive.

## Run
```bash
npm install
npm run dev
```

## Environment
Set these environment variables before running the app:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- SITE_URL
- RESEND_API_KEY
- EMAIL_FROM
- RESEND_FROM
- KV_REST_API_URL
- KV_REST_API_TOKEN
- ADMIN_TOKEN
- ADMIN_SESSION_SECRET
- BLOB_READ_WRITE_TOKEN
- INVENTORY_ALERT_EMAIL (optional)
- ADMIN_ALERT_EMAIL (optional fallback)
- LOW_STOCK_THRESHOLD (optional, default `2`)
- RATE_LIMIT_LOGIN_MAX (optional, default `10`)
- RATE_LIMIT_LOGIN_WINDOW_SECONDS (optional, default `300`)
- RATE_LIMIT_CHECKOUT_MAX (optional, default `20`)
- RATE_LIMIT_CHECKOUT_WINDOW_SECONDS (optional, default `60`)

## Seed KV (optional)
```bash
npm run seed:kv
```

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
- Mark paid orders shipped with inline success/error feedback.
- `stock_conflict` orders are non-shippable until resolved via the admin `Mark conflict resolved` action.

## Pages
- /shop
- /archive
- /about
- /contact
- /products/silver-band-01
